```javascript
// escpos-printer.js
// Client-side ESC/POS printing pipeline:
// 1) capture DOM with html2canvas
// 2) grayscale -> Floyd–Steinberg dither -> 1-bit bitmap
// 3) resize to printer width in dots
// 4) pack and encode as GS v 0 raster image
// 5) send raw bytes to printer via Web Serial / WebUSB / WebSocket proxy
//
// Usage: window.escposPrinter.printElementToPrinter(element, opts)
//
// Requirements: html2canvas must be loaded (global html2canvas).
// Note: WebUSB/Web Serial require HTTPS and user gesture to request devices.

(function (global) {
  'use strict';

  async function captureElementToCanvas(element, scale = 1) {
    if (typeof html2canvas === 'undefined') {
      throw new Error('html2canvas is required. Include it via <script src="https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"></script>');
    }
    // Force white background to avoid transparent pixels
    const canvas = await html2canvas(element, {
      backgroundColor: '#ffffff',
      scale: scale,
      useCORS: true,
      allowTaint: true
    });
    return canvas;
  }

  function resizeCanvasNearest(srcCanvas, targetWidth, targetHeight) {
    const dest = document.createElement('canvas');
    dest.width = targetWidth;
    dest.height = targetHeight;
    const ctx = dest.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(srcCanvas, 0, 0, srcCanvas.width, srcCanvas.height, 0, 0, targetWidth, targetHeight);
    return dest;
  }

  function grayscaleImageData(imgData) {
    const data = imgData.data;
    const width = imgData.width;
    const height = imgData.height;
    const gray = new Float32Array(width * height);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      const alpha = a / 255;
      const rr = r * alpha + 255 * (1 - alpha);
      const gg = g * alpha + 255 * (1 - alpha);
      const bb = b * alpha + 255 * (1 - alpha);
      // luminosity (0 = black, 255 = white)
      gray[p] = 0.299 * rr + 0.587 * gg + 0.114 * bb;
    }
    return { gray, width, height };
  }

  function floydSteinbergDither(grayArray, width, height) {
    // operates in-place on Float32Array grayArray [0..255] (0 black, 255 white)
    const bw = new Uint8Array(width * height); // 1 = black, 0 = white
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const oldVal = grayArray[idx];
        const newVal = oldVal < 128 ? 0 : 255; // 0 -> black, 255 -> white
        const err = oldVal - newVal;
        bw[idx] = newVal === 0 ? 1 : 0; // 1 for black
        // distribute error
        if (x + 1 < width) grayArray[idx + 1] += (err * 7) / 16;
        if (x - 1 >= 0 && y + 1 < height) grayArray[idx + width - 1] += (err * 3) / 16;
        if (y + 1 < height) grayArray[idx + width] += (err * 5) / 16;
        if (x + 1 < width && y + 1 < height) grayArray[idx + width + 1] += (err * 1) / 16;
      }
    }
    return bw;
  }

  function packBitsMonochrome(bitArray, width, height) {
    const bytesPerRow = Math.ceil(width / 8);
    const out = new Uint8Array(bytesPerRow * height);
    for (let y = 0; y < height; y++) {
      for (let bx = 0; bx < bytesPerRow; bx++) {
        let byte = 0x00;
        for (let bit = 0; bit < 8; bit++) {
          const x = bx * 8 + bit;
          if (x >= width) continue;
          const pix = bitArray[y * width + x]; // 1 = black
          // MSB is leftmost pixel of the byte
          if (pix) {
            byte |= (0x80 >> bit);
          }
        }
        out[y * bytesPerRow + bx] = byte;
      }
    }
    return { data: out, bytesPerRow };
  }

  function buildGsV0Raster(bytesPerRow, height, bitmapData, mode = 0) {
    // GS v 0: 1D 76 30 m xL xH yL yH [data]
    const xL = bytesPerRow & 0xFF;
    const xH = (bytesPerRow >> 8) & 0xFF;
    const yL = height & 0xFF;
    const yH = (height >> 8) & 0xFF;
    const header = new Uint8Array([0x1D, 0x76, 0x30, mode, xL, xH, yL, yH]);
    const out = new Uint8Array(header.length + bitmapData.length);
    out.set(header, 0);
    out.set(bitmapData, header.length);
    return out;
  }

  /* Transports */

  async function sendViaWebSocket(wsUrl, data) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
      ws.addEventListener('open', () => {
        ws.send(data);
      });
      ws.addEventListener('close', () => resolve());
      ws.addEventListener('error', (e) => reject(e));
      // If server sends back any message, resolve as success.
      ws.addEventListener('message', () => { /* no-op */ });
      // Fallback: resolve after short timeout if still open
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
          resolve();
        }
      }, 2000);
    });
  }

  async function sendToUsb(deviceHandle, dataBuffer) {
    // deviceHandle: { device, ifaceNumber, endpointNumber } returned by openUsbDevice
    const { device, endpointNumber } = deviceHandle;
    if (!device || !device.opened) {
      await device.open();
    }
    if (device.configuration === null) {
      await device.selectConfiguration(1);
    }
    try {
      await device.claimInterface(deviceHandle.ifaceNumber);
    } catch (e) {
      // may already be claimed
    }
    await device.transferOut(endpointNumber, dataBuffer);
  }

  async function openUsbDevice(opts = {}) {
    if (!navigator.usb) throw new Error('WebUSB not available in this browser');
    let device;
    if (opts.filters && opts.filters.length) {
      device = await navigator.usb.requestDevice({ filters: opts.filters });
    } else {
      const devices = await navigator.usb.getDevices();
      if (devices.length === 0) {
        device = await navigator.usb.requestDevice({ filters: [] }).catch((e) => {
          throw new Error('No USB device selected or WebUSB request blocked. Provide vendor/product filters if needed.');
        });
      } else {
        device = devices[0];
      }
    }
    await device.open();
    if (device.configuration === null) {
      await device.selectConfiguration(1);
    }

    let ifaceNumber = null;
    let endpointNumber = null;
    for (const cfg of device.configuration.interfaces) {
      for (const alt of cfg.alternates) {
        if (!alt.endpoints) continue;
        for (const ep of alt.endpoints) {
          if (ep.direction === 'out') {
            ifaceNumber = cfg.interfaceNumber;
            endpointNumber = ep.endpointNumber;
            break;
          }
        }
        if (endpointNumber !== null) break;
      }
      if (endpointNumber !== null) break;
    }
    if (ifaceNumber === null) {
      throw new Error('Could not find an OUT endpoint on the selected USB device.');
    }
    await device.claimInterface(ifaceNumber);
    return { device, ifaceNumber, endpointNumber };
  }

  /* High-level print function */

  async function printElementToPrinter(element, opts = {}) {
    const widthDots = opts.widthDots || 384;
    const transport = opts.transport || 'serial';
    const mode = (typeof opts.mode === 'number') ? opts.mode : 0;

    // 1) capture DOM to canvas
    const baseCanvas = await captureElementToCanvas(element, 1);

    // 2) target pixel width = widthDots
    const targetWidth = widthDots;
    const scale = targetWidth / baseCanvas.width;
    const targetHeight = Math.max(1, Math.round(baseCanvas.height * scale));
    const canvas = resizeCanvasNearest(baseCanvas, targetWidth, targetHeight);

    // 3) grayscale
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { gray, width, height } = grayscaleImageData(imgData);

    // 4) dithering to 1-bit
    const bitArray = floydSteinbergDither(gray, width, height);

    // 5) pack bits
    const { data: packed, bytesPerRow } = packBitsMonochrome(bitArray, width, height);

    // 6) build ESC/POS GS v 0 raster data
    const escposData = buildGsV0Raster(bytesPerRow, height, packed, mode);

    // Optionally append line feeds or cut command if desired:
    // const feedAndCut = new Uint8Array([0x0A, 0x0A, 0x1D, 0x56, 0x41, 0x10]); // example feed + partial cut
    // const finalData = new Uint8Array(escposData.length + feedAndCut.length);
    // finalData.set(escposData, 0); finalData.set(feedAndCut, escposData.length);

    const finalData = escposData;

    // 7) send via transport
    if (transport === 'serial') {
      if (!('serial' in navigator)) {
        throw new Error('Web Serial API not available in this browser.');
      }
      const port = opts.serialPort || await navigator.serial.requestPort();
      const openOptions = opts.serialOptions || { baudRate: 19200 };
      if (!port.readable || !port.writable || !port) {
        // open if not open already
      }
      await port.open(openOptions);
      const writer = port.writable.getWriter();
      try {
        await writer.write(finalData);
      } finally {
        writer.releaseLock();
        if (opts.closeSerialAfterPrint) {
          await port.close();
        }
      }
      return { success: true, transport: 'serial' };
    } else if (transport === 'usb') {
      if (!navigator.usb) throw new Error('WebUSB not available in this browser.');
      const usbHandle = opts.usbHandle || await openUsbDevice(opts.usbOptions || {});
      await sendToUsb(usbHandle, finalData.buffer);
      if (opts.closeUsbAfterPrint && usbHandle && usbHandle.device) {
        try {
          await usbHandle.device.releaseInterface(usbHandle.ifaceNumber);
          await usbHandle.device.close();
        } catch (e) { /* ignore */ }
      }
      return { success: true, transport: 'usb' };
    } else if (transport === 'websocket') {
      if (!opts.wsUrl) throw new Error('wsUrl required for websocket transport');
      await sendViaWebSocket(opts.wsUrl, finalData.buffer);
      return { success: true, transport: 'websocket' };
    } else {
      throw new Error('Unknown transport: ' + transport);
    }
  }

  // expose
  global.escposPrinter = {
    captureElementToCanvas,
    resizeCanvasNearest,
    grayscaleImageData,
    floydSteinbergDither,
    packBitsMonochrome,
    buildGsV0Raster,
    openUsbDevice,
    printElementToPrinter
  };

})(window);
```