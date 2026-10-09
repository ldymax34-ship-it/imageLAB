/* Strict SVG path grammar adapter. Split on authored moveto commands, never
 * infer subpath boundaries from geometric distance. Output uses absolute
 * commands but preserves C/S/Q/T/A geometry for native browser sampling. */
(function (root) {
  "use strict";
  function splitPathData(text, maxCommands = 10000) {
    if (typeof text !== "string" || text.length > 200000) throw new Error("SVG 路径数据过长或无效");
    let pos=0, x=0, y=0, sx=0, sy=0, command=null, parts=[], closed=false, count=0;
    const paths=[];
    const error=()=>{throw new Error("SVG 路径语法无效，位置 "+pos);};
    const skip=()=>{while(pos<text.length && /[\s,]/.test(text[pos]))pos++;};
    const number=()=>{
      skip();
      const m=/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(text.slice(pos));
      if(!m)error();
      pos+=m[0].length;
      const n=Number(m[0]);
      if(!Number.isFinite(n)||Math.abs(n)>1e6)error();
      return n;
    };
    const flag=()=>{skip();const c=text[pos++];if(c!=="0"&&c!=="1")error();return Number(c);};
    const endpoint=(relative)=>{
      let nx=number(),ny=number();
      if(relative){nx+=x;ny+=y;}
      if(Math.abs(nx)>1e6||Math.abs(ny)>1e6)error();
      return [nx,ny];
    };
    const flush=()=>{if(parts.length)paths.push({d:parts.join(" "),closed});parts=[];closed=false;};
    while(true) {
      skip();
      if(pos>=text.length)break;
      if(/[a-zA-Z]/.test(text[pos]))command=text[pos++];
      else if(!command)error();
      if(++count>maxCommands)throw new Error("SVG 路径命令超过上限");
      const c=command.toUpperCase(), rel=command!==c;
      if(!"MLHVCSQTAZ".includes(c))error();
      if(!parts.length && c!=="M")error();
      if(c==="Z") {
        parts.push("Z");x=sx;y=sy;closed=true;command=null;continue;
      }
      const values=[];
      if(c==="M") {
        const p=endpoint(rel);flush();[x,y]=p;sx=x;sy=y;
        parts.push("M "+p.join(" "));command=rel?"l":"L";continue;
      }
      if(c==="H") {
        let nx=number();if(rel)nx+=x;if(Math.abs(nx)>1e6)error();
        x=nx;values.push(x);
      } else if(c==="V") {
        let ny=number();if(rel)ny+=y;if(Math.abs(ny)>1e6)error();
        y=ny;values.push(y);
      } else if(c==="A") {
        const rx=number(),ry=number(),rotation=number();
        if(rx<0||ry<0)error();
        values.push(rx,ry,rotation,flag(),flag());
        const p=endpoint(rel);values.push(...p);[x,y]=p;
      } else {
        const pairs=c==="C"?3:c==="S"||c==="Q"?2:1;
        for(let i=0;i<pairs;i++)values.push(...endpoint(rel));
        x=values[values.length-2];y=values[values.length-1];
      }
      parts.push(c+" "+values.join(" "));closed=false;
    }
    flush();
    if(!paths.length)error();
    return paths;
  }
  root.SvgPathData={splitPathData};
  if(typeof module!=="undefined")module.exports=root.SvgPathData;
})(typeof window!=="undefined"?window:globalThis);
