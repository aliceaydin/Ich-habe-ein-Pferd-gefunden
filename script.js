// script.js (updated — adds robustness for printing pipeline and loads html2canvas if missing)
document.addEventListener("DOMContentLoaded", () => {

  const input = document.getElementById("replyInput");
  const paper = document.getElementById("paper");
  const printBtn = document.getElementById("printBtn");
  const charCount = document.getElementById("charCount");
  const SHAPES_DEFS = document.getElementById("shapes-defs");

  if(!input || !paper || !printBtn || !charCount || !SHAPES_DEFS){
    console.error("Ein wichtiges Element fehlt im DOM!");
    return;
  }

  const POSTER_FONTS = [
    "TASA Orbiter",
    "Rubik Glitch",
    "Tilt Neon",
    "Bungee"
  ];

  const PADDING = 16;
  const THROTTLE_MS = 80;

  function rnd(){const a=new Uint32Array(1);crypto.getRandomValues(a);return a[0]/4294967295;}
  function rndInt(a,b){return Math.floor(rnd()*(b-a+1))+a;}
  function rndRange(a,b){return rnd()*(b-a)+a;}
  function pick(a){return a[Math.floor(rnd()*a.length)];}

  function getShapes(){
    return Array.from(SHAPES_DEFS.children).map(n=>n.cloneNode(true));
  }

  function setPaperHeight(mm){
    paper.style.height = mm+"mm";
    return new Promise(res=>requestAnimationFrame(()=>{
      const r = paper.getBoundingClientRect();
      res({w:r.width,h:r.height});
    }));
  }

  function createSvg(w,h){
    const ns="http://www.w3.org/2000/svg";
    const svg=document.createElementNS(ns,"svg");
    svg.setAttribute("viewBox",`0 0 ${w} ${h}`);
    svg.setAttribute("width","100%");
    svg.setAttribute("height","auto");

    const bg=document.createElementNS(ns,"rect");
    bg.setAttribute("width",w);
    bg.setAttribute("height",h);
    bg.setAttribute("fill","#fff");
    svg.appendChild(bg);

    return svg;
  }

  function safeBBox(el){try{return el.getBBox();}catch(e){return null;}}

  function addText(svg,x,y,txt,size){
    const ns="http://www.w3.org/2000/svg";
    const t=document.createElementNS(ns,"text");
    t.setAttribute("x",x);
    t.setAttribute("y",y);
    t.setAttribute("font-family", pick(POSTER_FONTS)+", sans-serif");
    t.setAttribute("font-size",size);
    t.setAttribute("font-weight",900);
    t.setAttribute("fill","#000");
    t.textContent=txt;
    svg.appendChild(t);

    if(rnd()<0.4){
      const b=safeBBox(t);
      if(b){
        const cx=b.x+b.width/2;
        const cy=b.y+b.height/2;
        t.setAttribute(
          "transform",
          `rotate(${pick([0,90,-90,180])} ${cx} ${cy})`
        );
      }
    }
    return t;
  }

  function fitTextToWidth(el,maxWidth){
    const box=safeBBox(el);
    if(!box||box.width<=maxWidth) return;
    const sx=maxWidth/box.width;
    el.setAttribute("transform",
      (el.getAttribute("transform")||"")+` scale(${sx} 1)`
    );
  }

  function duplicateAlt(svg,base,copies=3,step=6){
    const b=safeBBox(base); if(!b) return;
    for(let i=1;i<=copies;i++){
      const c=base.cloneNode(true);
      c.setAttribute("fill",i%2?"#fff":"#000");
      c.setAttribute(
        "transform",
        (c.getAttribute("transform")||"")+
        ` translate(${step*i*(i%2?1:-1)},${step*i*(i%2?1:-1)})`
      );
      svg.appendChild(c);
    }
  }

  function placeBigShape(svg,shapes,w,h){
    if(!shapes.length) return;
    const s=pick(shapes);
    const g=s.cloneNode(true);
    // build transform string in one template to avoid accidental syntax issues
    const tx = `translate(${rndRange(w*0.2,w*0.8)} ${rndRange(h*0.3,h*0.95)})`;
    const rt = `rotate(${pick([0,90,180,-90])})`;
    const sc = `scale(${rndRange(0.4,1.8)})`;
    g.setAttribute("transform", `${tx} ${rt} ${sc}`);
    Array.from(g.querySelectorAll("*")).forEach(n=>{
      n.setAttribute("fill","#000");
      n.setAttribute("stroke","none");
    });
    svg.appendChild(g);
  }

  function posterVertical(svg,lines,w,h){
    let y=h*0.12;
    lines.forEach(txt=>{
      const size = rnd()<0.3
        ? rndRange(h*0.25,h*0.6)
        : rndRange(h*0.08,h*0.18);
      const t=addText(svg,PADDING,y,txt,Math.round(size));
      fitTextToWidth(t,w-PADDING*2);
      if(rnd()>0.6) duplicateAlt(svg,t,rndInt(1,4),6);
      y+=size*0.9;
    });
    if(y<h*0.85){
      const filler=pick(lines);
      const size=rndRange(h*0.18,h*0.35);
      addText(svg,PADDING,h*rndRange(0.7,0.92),filler,size);
    }
  }

  function posterPattern(svg,lines,w,h){
    const word=pick(lines);
    const cols=rndInt(2,4);
    const rows=rndInt(4,8);
    const size=rndRange(h*0.08,h*0.16);
    for(let r=0;r<rows;r++){
      for(let c=0;c<cols;c++){
        const t=addText(svg,PADDING+c*(w/cols),PADDING+r*size*1.3,word,size);
        if(rnd()<0.4) duplicateAlt(svg,t,2,4);
      }
    }
  }

  function composePoster(lines,w,h){
    paper.innerHTML="";
    const svg=createSvg(w,h);
    paper.appendChild(svg);

    const shapes=getShapes();
    pick([posterVertical,posterPattern])(svg,lines,w,h);
    if(rnd()<0.8) placeBigShape(svg,shapes,w,h);
    if(rnd()<0.5) placeBigShape(svg,shapes,w,h);
  }

  let timer=null;

  function generate(){
    const txt=input.value.trim();
    charCount.textContent=`${txt.length}/250`;
    if(!txt){paper.innerHTML="";return;}

    let words=txt.split(/\s+/);
    if(rnd()<0.35 && words.length>3){
      words=words.map(w=>rnd()<0.3?w.toUpperCase():w);
    }

    let lines=[],line="";
    words.forEach(w=>{
      if((line+" "+w).length<20) line+=" "+w;
      else{lines.push(line.trim()); line=w;}
    });
    if(line) lines.push(line.trim());

    const mm_height=180 + txt.length*2.2 + Math.pow(txt.length,1.15);

    setPaperHeight(mm_height).then(dim=>{
      clearTimeout(timer);
      timer=setTimeout(()=>composePoster(lines,dim.w,dim.h),THROTTLE_MS);
    });
  }

  const QUESTIONS = [
  "What did you find here without looking for it?",
  "What will you remember from today?",
  "What are you thinking about right now?",
  "What thought passed through you and disappeared?",
  "What did you notice only after staying a while?",
  "What is present here, but easy to miss?",
  "What are you aware of now that you weren’t before?",
  "What part of this experience feels personal?",
  "What did this space allow you to think about?",
  "Has time slowed down or sped up for you in this exhibition?"
];

  // setze beim Laden der Seite zufällig eine Frage
  document.querySelector(".q-text").textContent = pick(QUESTIONS);

  input.addEventListener("input",generate);

  // -------------------------------
  // Printing pipeline (ESC/POS to Citizen thermal printer)
  // - captures #paper with html2canvas
  // - grayscale -> Floyd–Steinberg dither -> 1-bit bitmap
  // - resizes to printer width (dots) e.g. 384 or 576
  // - encodes GS v 0 raster and sends raw bytes via Web Serial / WebUSB / WebSocket proxy
  // -------------------------------

  // load script helper (if html2canvas missing)
  function loadScript(src){
    return new Promise((resolve,reject)=>{
      const s=document.createElement('script');
      s.src=src;
      s.onload=()=>resolve();
      s.onerror=(e)=>reject(new Error('Failed to load '+src));
      document.head.appendChild(s);
    });
  }

  // helper: capture
  async function captureElementToCanvas(element, scale = 1) {
    if (typeof html2canvas === 'undefined') {
      // attempt to load html2canvas dynamically
      try {
        await loadScript('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js');
      } catch (e) {
        throw new Error('html2canvas is required but could not be loaded. Ensure network access or include the library in index.html.');
      }
      if (typeof html2canvas === 'undefined') {
        throw new Error('html2canvas still not available after loading.');
      }
    }
    const canvas = await html2canvas(element, {
      backgroundColor: '#ffffff',
      scale,
      useCORS: true,
      allowTaint: true
    });
    if (!canvas || !canvas.width || !canvas.height) {
      throw new Error('Captured canvas has zero width/height. Ensure the #paper element is visible with layout before printing.');
    }
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
      gray[p] = 0.299 * rr + 0.587 * gg + 0.114 * bb;
    }
    return { gray, width, height };
  }

  function floydSteinbergDither(grayArray, width, height) {
    const bw = new Uint8Array(width * height); // 1=black
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const oldVal = grayArray[idx];
        const newVal = oldVal < 128 ? 0 : 255;
        const err = oldVal - newVal;
        bw[idx] = newVal === 0 ? 1 : 0;
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
          if (pix) byte |= (0x80 >> bit); // MSB = leftmost pixel
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

  // Web Serial send
  async function sendToSerial(port, data) {
    const openOptions = { baudRate: 19200 };
    if (!port.readable || !port.writable) {
      await port.open(openOptions);
    }
    const writer = port.writable.getWriter();
    try {
      await writer.write(data);
    } finally {
      writer.releaseLock();
    }
  }

  // WebUSB helpers
  async function openUsbDevice(opts = {}) {
    if (!navigator.usb) throw new Error('WebUSB not available in this browser');
    let device;
    if (opts.filters && opts.filters.length) {
      device = await navigator.usb.requestDevice({ filters: opts.filters });
    } else {
      const devices = await navigator.usb.getDevices();
      if (devices.length === 0) {
        device = await navigator.usb.requestDevice({ filters: [] }).catch(() => {
          throw new Error('No USB device selected (WebUSB request cancelled).');
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
    if (ifaceNumber === null) throw new Error('Could not find OUT endpoint on USB device');
    await device.claimInterface(ifaceNumber);
    return { device, ifaceNumber, endpointNumber };
  }

  async function sendToUsb(deviceHandle, data) {
    const { device, endpointNumber } = deviceHandle;
    await device.transferOut(endpointNumber, data);
  }

  // WebSocket proxy send
  async function sendViaWebSocket(wsUrl, data) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
      ws.addEventListener('open', () => {
        ws.send(data);
      });
      ws.addEventListener('close', () => resolve());
      ws.addEventListener('error', (e) => reject(e));
      // resolve after short timeout if still open
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
          resolve();
        }
      }, 1500);
    });
  }

  // Main print flow
  async function printPaperToThermal(options = {}) {
    const widthDots = options.widthDots || 384;
    const transport = options.transport || 'serial';
    const mode = (typeof options.mode === 'number') ? options.mode : 0;

    // Capture
    const baseCanvas = await captureElementToCanvas(paper, 1);

    // Validate baseCanvas size
    if (!baseCanvas || !baseCanvas.width || !baseCanvas.height) {
      throw new Error('Captured canvas invalid (zero width/height). Cannot print.');
    }

    // Resize so canvas width equals printer dots
    const targetWidth = widthDots;
    const scale = targetWidth / baseCanvas.width;
    const targetHeight = Math.max(1, Math.round(baseCanvas.height * scale));
    const canvas = resizeCanvasNearest(baseCanvas, targetWidth, targetHeight);

    // Grayscale
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { gray, width, height } = grayscaleImageData(imgData);

    // Dither to 1-bit
    const bitArray = floydSteinbergDither(gray, width, height);

    // Pack into bytes
    const { data: packed, bytesPerRow } = packBitsMonochrome(bitArray, width, height);

    // Build GS v 0 raster
    const escposData = buildGsV0Raster(bytesPerRow, height, packed, mode);

    // Append some feeds (some printers need extra feed)
    const feed = new Uint8Array([0x0A, 0x0A, 0x0A]);
    const finalData = new Uint8Array(escposData.length + feed.length);
    finalData.set(escposData, 0);
    finalData.set(feed, escposData.length);

    // Send
    if (transport === 'serial') {
      if (!('serial' in navigator)) throw new Error('Web Serial API not available in this browser.');
      const port = options.serialPort || await navigator.serial.requestPort();
      await sendToSerial(port, finalData);
      return;
    }
    if (transport === 'usb') {
      if (!navigator.usb) throw new Error('WebUSB not available in this browser.');
      const handle = await openUsbDevice(options.usbOptions || {});
      await sendToUsb(handle, finalData.buffer);
      return;
    }
    if (transport === 'websocket') {
      if (!options.wsUrl) throw new Error('wsUrl required for websocket transport');
      await sendViaWebSocket(options.wsUrl, finalData.buffer);
      return;
    }
    throw new Error('Unknown transport: ' + transport);
  }

  // UI: when user clicks Print, ask which transport to use and run pipeline.
  printBtn.addEventListener("click", async () => {
    try {
      const defaultTransport = (('serial' in navigator) ? 'serial' : (navigator.usb ? 'usb' : 'websocket'));
      const t = prompt(`Print to thermal printer via (type one):\n- serial\n- usb\n- websocket\n\nDefault: ${defaultTransport}`, defaultTransport);
      if (!t) return;
      const transport = t.trim().toLowerCase();
      const widthInput = prompt('Printer width in dots (384 for 58mm / 576 for 80mm)', '384');
      const widthDots = parseInt(widthInput || '384', 10) || 384;

      const opts = { transport, widthDots };

      if (transport === 'serial') {
        if (!('serial' in navigator)) {
          alert('Web Serial is not available in this browser. Try WebUSB or WebSocket proxy.');
          return;
        }
        const port = await navigator.serial.requestPort();
        opts.serialPort = port;
        opts.serialOptions = { baudRate: 19200 };
      } else if (transport === 'usb') {
        // optional: set opts.usbOptions = { filters: [...] } if you know vendor/product
      } else if (transport === 'websocket') {
        const wsUrl = prompt('WebSocket proxy URL (e.g. ws://localhost:9000)', 'ws://localhost:9000');
        if (!wsUrl) return;
        opts.wsUrl = wsUrl;
      } else {
        alert('Unknown transport selected.');
        return;
      }

      printBtn.disabled = true;
      printBtn.textContent = 'Contribute';
      await printPaperToThermal(opts);
      alert('Print job sent to printer.');
    } catch (err) {
      console.error(err);
      alert('Print failed: ' + (err && err.message ? err.message : String(err)));
    } finally {
      printBtn.disabled = false;
      printBtn.textContent = 'Contribute';
    }
  });

  generate();
});

/* =========================
   SCRIBBLE BACKGROUND LOGIC
========================= */

const SCRIBBLE_SVGS = [
  "Flower1.svg",
  "Flower2.svg",
  "Flower3.svg",
  "Horse.svg",
  "Horse2.svg",
  "Horse3.svg",
  "Horse4.svg",
  "Horse5.svg",
  "Horse6.svg",
  "Horse7.svg",
  "Horse8.svg"
];

const SCRIBBLE_COUNT = 14;

function rnd(min, max){
  return Math.random() * (max - min) + min;
}

async function loadSvg(url){
  const res = await fetch(url);
  return await res.text();
}

async function initScribbles(){
  const container = document.getElementById("scribble-bg");
  if(!container) return;

  container.innerHTML = "";

  for(let i = 0; i < SCRIBBLE_COUNT; i++){
    const url = SCRIBBLE_SVGS[Math.floor(Math.random() * SCRIBBLE_SVGS.length)];
    const svgText = await loadSvg(url);

    const wrapper = document.createElement("div");
    wrapper.className = "scribble sparkle"; // 👈 HIER

    wrapper.innerHTML = svgText;
    
// kleine Glitzer erzeugen
const GLITTER_COUNT = Math.floor(rnd(3, 7));

for(let g = 0; g < GLITTER_COUNT; g++){
  const glitter = document.createElement("div");
  glitter.className = "glitter";

  glitter.style.left = rnd(10, 90) + "%";
  glitter.style.top = rnd(10, 90) + "%";
  glitter.style.animationDelay = rnd(0, 1.5) + "s";

  wrapper.appendChild(glitter);
}

    // SVG direkt ansprechen
    const svg = wrapper.querySelector("svg");
    if(svg){
      svg.classList.add("sparkle");
    }

    const size = rnd(80, 220);
    const x = rnd(-10, 100);
    const y = rnd(-10, 100);
    const rot = rnd(-25, 25);
    const durY = rnd(6, 14);
    const durX = rnd(8, 18);

    wrapper.style.width = size + "px";
    wrapper.style.left = x + "vw";
    wrapper.style.top = y + "vh";
    wrapper.style.transform = `rotate(${rot}deg)`;

    wrapper.style.animationDuration = `${durY}s, ${durX}s`;

    container.appendChild(wrapper);
  }
}

/* beim Laden der Seite */
window.addEventListener("load", initScribbles);
