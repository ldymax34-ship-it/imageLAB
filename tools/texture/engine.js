/* Pure geometry; no network, DOM or third-party runtime. */
(function (root) {
  "use strict";
  const defaults = {width:1200,height:800,grid:"hex",shape:"circle",spacing:18,diameter:9,
    field:"uniform",spread:85,angle:0,contrast:1.2,levels:5,invert:false,
    seam:"wave",seamScale:360,keepout:26,fade:100,guides:true,
    ink:"#253c38",paper:"#f5f1e8",transparent:false,exportGuides:false,scale:2,cx:.5,cy:.5};
  const ranges = {width:[200,2000],height:[200,2000],spacing:[12,48],diameter:[1,24],spread:[15,140],
    angle:[0,360],contrast:[.3,3],levels:[0,8],seamScale:[120,600],keepout:[0,80],fade:[0,160],scale:[1,4],cx:[0,1],cy:[0,1]};
  const enums = {grid:["hex","square"],shape:["circle","ellipse","square","diamond"],
    field:["radial","linear","wave","uniform","image"],seam:["none","diamond","wave"]};
  function normalize(input={}) {
    const out={...defaults};
    if(!input || typeof input!=="object" || Array.isArray(input))return out;
    for(const [k,v] of Object.entries(input)) {
      if(Object.hasOwn(ranges,k) && typeof v==="number" && Number.isFinite(v)) out[k]=Math.min(ranges[k][1],Math.max(ranges[k][0],v));
      else if(Object.hasOwn(enums,k) && enums[k].includes(v)) out[k]=v;
      else if(["ink","paper"].includes(k) && typeof v==="string" && /^#[0-9a-f]{6}$/i.test(v)) out[k]=v;
      else if(Object.hasOwn(defaults,k) && typeof defaults[k]==="boolean" && typeof v==="boolean") out[k]=v;
    }
    out.width=Math.round(out.width); out.height=Math.round(out.height);
    if(![0,3,5,8].includes(out.levels)) out.levels=0;
    if(![1,2,4].includes(out.scale)) out.scale=2;
    return out;
  }
  const clamp=t=>Math.max(0,Math.min(1,t));
  const smooth=t=>{t=clamp(t);return t*t*(3-2*t);};
  function segmentDistanceSquared(x,y,a,b) {
    const dx=b[0]-a[0],dy=b[1]-a[1],l=dx*dx+dy*dy;
    const t=l?clamp(((x-a[0])*dx+(y-a[1])*dy)/l):0;
    const ex=x-a[0]-t*dx,ey=y-a[1]-t*dy;
    return ex*ex+ey*ey;
  }
  function segmentDistance(x,y,a,b) {
    return Math.sqrt(segmentDistanceSquared(x,y,a,b));
  }
  function seams(s) {
    if(s.seam==="none")return [];
    const paths=[],w=s.width,h=s.height,period=s.seamScale;
    if(s.seam==="diamond") {
      for(const sign of [-1,1]) for(let y=-w;y<=h+w;y+=period*.65)
        paths.push([[0,y],[w,y+sign*w*.65]]);
    } else {
      for(const sign of [-1,1]) for(let y=-period;y<=h+period;y+=period*.65) {
        const path=[];
        for(let i=0;i<=48;i++) {
          const x=w*i/48;
          path.push([x,y+sign*Math.sin(x/w*Math.PI*2)*period*.44]);
        }
        paths.push(path);
      }
    }
    return paths;
  }
  function pathDistance(x,y,paths) {
    let d=Infinity;
    for(const p of paths)for(let i=1;i<p.length;i++)d=Math.min(d,segmentDistanceSquared(x,y,p[i-1],p[i]));
    return Math.sqrt(d);
  }
  function fieldValue(x,y,s,image) {
    const nx=(x-s.cx*s.width)/s.width,ny=(y-s.cy*s.height)/s.height;
    const angle=s.angle*Math.PI/180,spread=s.spread/100;
    let v=1;
    if(s.field==="radial")v=clamp(1-Math.hypot(nx,ny)*2/spread);
    else if(s.field==="linear")v=clamp(.5+(nx*Math.cos(angle)+ny*Math.sin(angle))/spread);
    else if(s.field==="wave")v=(Math.cos(Math.hypot(nx,ny)*Math.PI*8/spread)+1)/2;
    else if(s.field==="image" && image) {
      const ix=Math.min(image.width-1,Math.floor(x/s.width*image.width));
      const iy=Math.min(image.height-1,Math.floor(y/s.height*image.height));
      v=image.data[iy*image.width+ix];
    }
    if(s.invert)v=1-v;
    return Math.pow(clamp(v),s.contrast);
  }
  /* `custom` is optional and only used by the curve tab:
   *   {polylines:[[[x,y],...]], segments:[[{closed,segments}]]}
   * When given it replaces the built-in seam paths entirely (even if empty),
   * so an empty curve document produces no keep-out. */
  function generate(input,image=null,custom=null) {
    const s=normalize(input);
    const customPolylines=custom&&Array.isArray(custom.polylines)?custom.polylines:null;
    const paths=customPolylines||seams(s),dots=[];
    const dy=s.spacing*(s.grid==="hex"?Math.sqrt(3)/2:1);
    const maxR=Math.min(s.diameter,(s.shape==="square"?Math.min(s.spacing,dy):s.spacing)-2)/2;
    // Bound radius of each shape, including square corners, for conservative keep-out.
    const boundFactor=s.shape==="square"?Math.SQRT2:1;
    let area=0;
    for(let row=0,y=s.spacing/2;y<s.height;y+=dy,row++) {
      const offset=s.grid==="hex"&&row%2?s.spacing/2:0;
      for(let x=s.spacing/2+offset;x<s.width;x+=s.spacing) {
        const d=pathDistance(x,y,paths);
        const available=d-s.keepout/2;
        if(paths.length && available<=0)continue;
        const f=fieldValue(x,y,s,image);
        let attenuation=1;
        if(paths.length && s.fade>0)attenuation=smooth((available-maxR*boundFactor)/s.fade);
        let r=maxR*f*attenuation;
        if(s.levels)r=Math.round(r/maxR*s.levels)/s.levels*maxR;
        // Omit oversized discrete holes instead of creating off-grid diameter values.
        if(paths.length && r*boundFactor>available) {
          if(s.levels)r=Math.floor(available/boundFactor/maxR*s.levels)/s.levels*maxR;
          else r=available/boundFactor;
        }
        if(r<.22 || x-r<0 || y-r<0 || x+r>s.width || y+r>s.height)continue;
        dots.push({x,y,r});
        area+=s.shape==="square"?4*r*r:s.shape==="diamond"?2*r*r:Math.PI*r*r*(s.shape==="ellipse"?.46:1);
      }
    }
    return {settings:s,paths,dots,coverage:area/(s.width*s.height),maxDiameter:maxR*2,
      pathSegments:custom&&Array.isArray(custom.segments)?custom.segments:null};
  }
  const n=x=>Number(x.toFixed(3));
  /* Exact line/arc path data for one subpath. Used by the curve tab so imported
   * arcs and fitted arcs survive as real arcs instead of being flattened. */
  function subpathPathData(sub) {
    const segs=sub&&sub.segments||[];
    if(!segs.length)return "";
    let d="M"+n(segs[0].p0[0])+" "+n(segs[0].p0[1]),prev=segs[0].p0;
    for(const seg of segs) {
      if(Math.abs(prev[0]-seg.p0[0])>1e-6||Math.abs(prev[1]-seg.p0[1])>1e-6)
        d+="M"+n(seg.p0[0])+" "+n(seg.p0[1]);
      if(seg.kind==="line")d+="L"+n(seg.p1[0])+" "+n(seg.p1[1]);
      else {
        const large=Math.abs(seg.sweep)>Math.PI?1:0,sweep=seg.sweep>0?1:0;
        d+="A"+n(seg.r)+" "+n(seg.r)+" 0 "+large+" "+sweep+" "+n(seg.p1[0])+" "+n(seg.p1[1]);
      }
      prev=seg.p1;
    }
    if(sub.closed)d+="Z";
    return d;
  }
  function toSVG(model,{guides=model.settings.exportGuides}={}) {
    const s=model.settings,parts=[`<svg xmlns="http://www.w3.org/2000/svg" width="${s.width}" height="${s.height}" viewBox="0 0 ${s.width} ${s.height}">`,
      "<title>纹理间 · 参数化纹理</title>"];
    if(!s.transparent)parts.push(`<rect width="${s.width}" height="${s.height}" fill="${s.paper}"/>`);
    parts.push(`<g id="pattern" fill="${s.ink}">`);
    for(const dot of model.dots) {
      const {x,y,r}=dot;
      if(s.shape==="circle")parts.push(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}"/>`);
      else if(s.shape==="ellipse")parts.push(`<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(r)}" ry="${n(r*.46)}"/>`);
      else if(s.shape==="square")parts.push(`<rect x="${n(x-r)}" y="${n(y-r)}" width="${n(2*r)}" height="${n(2*r)}"/>`);
      else parts.push(`<path d="M${n(x)} ${n(y-r)}L${n(x+r)} ${n(y)}L${n(x)} ${n(y+r)}L${n(x-r)} ${n(y)}Z"/>`);
    }
    parts.push("</g>");
    if(guides && ((model.pathSegments&&model.pathSegments.length)||model.paths.length)) {
      parts.push('<defs><clipPath id="canvas-clip"><rect width="'+s.width+'" height="'+s.height+'"/></clipPath></defs><g id="seam-guides" clip-path="url(#canvas-clip)" fill="none" stroke="#da8075">');
      if(model.pathSegments&&model.pathSegments.length) {
        for(const sub of model.pathSegments) {
          const d=subpathPathData(sub);
          if(!d)continue;
          if(s.keepout>0)parts.push(`<path d="${d}" stroke-width="${s.keepout}" opacity=".14"/>`);
          parts.push(`<path d="${d}" stroke-width="1.2" stroke-dasharray="6 5"/>`);
        }
      } else for(const p of model.paths) {
        const d=p.map((xy,i)=>(i?"L":"M")+xy.map(n).join(" ")).join("");
        if(s.keepout>0)parts.push(`<path d="${d}" stroke-width="${s.keepout}" opacity=".14"/>`);
        parts.push(`<path d="${d}" stroke-width="1.2" stroke-dasharray="6 5"/>`);
      }
      parts.push("</g>");
    }
    return parts.join("")+"</svg>";
  }
  root.PatternEngine={defaults,normalize,generate,toSVG,subpathPathData,segmentDistance,pathDistance,seams,fieldValue};
  if(typeof module!=="undefined")module.exports=root.PatternEngine;
})(typeof window!=="undefined"?window:globalThis);
