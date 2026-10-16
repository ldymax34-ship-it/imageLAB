const axes=[['horizontal','水平'],['vertical','垂直']];
function block(title,key,on,body,scope){return `<section class="inspector-section fx-block ${on?'enabled':''}"><div class="effect-heading"><strong>${title}</strong><input aria-label="启用 ${title}" type="checkbox" data-scope="${scope}" data-key="${key}" ${on?'checked':''}></div><div class="fx-controls">${body}</div></section>`}
function choice(label,key,value,options,scope){return `<label><span class="field-label">${label}</span><select data-scope="${scope}" data-key="${key}">${options.map(([v,n])=>`<option value="${v}" ${v===value?'selected':''}>${n}</option>`).join('')}</select></label>`}
function color(label,key,value){return `<label class="color-label">${label}<input aria-label="${label}" type="color" data-scope="effects" data-key="${key}" value="${value}"><span>${value.toUpperCase()}</span></label>`}
function seed(key,value,scope,label='种子'){return `<label><span class="field-label">${label}</span><input type="number" data-scope="${scope}" data-key="${key}" min="-2147483647" max="2147483647" step="1" value="${value}"></label>`}
export function vectorControls(l,range){
 const r=(label,k,min,max,step=1)=>range(label,k,l[k],min,max,step);
 return `<div class="fx-divider">矢量变形 <span>按源形状 · 镜像前</span></div>`+
 block('回声 / 拖尾','echo',l.echo,r('副本数','echoCount',1,12)+r('距离 / 源尺寸','echoDistance',0,1,.01)+r('方向, °','echoAngle',0,360)+r('每份缩放','echoScale',.5,1.2,.01)+r('每份不透明度','echoOpacity',0,1,.01),'layer');
}
export function rasterControls(e,range){
 const r=(label,k,min,max,step=1)=>range(label,k,e[k],min,max,step,'effects'),axis=k=>choice('方向',k,e[k],axes,'effects'),b=(name,k,body)=>block(name,k,e[k],body,'effects');
 return `<div class="fx-divider">几何与动态</div>`+
 b('像素拉伸','pixelStretch',axis('pixelStretchAxis')+r('取样条位置','pixelStretchPosition',0,1,.01)+r('取样条宽度','pixelStretchWidth',.001,.2,.001)+r('拉伸长度','pixelStretchLength',0,1,.01))+
 b('像素排序','pixelSort',axis('sortAxis')+choice('排序依据','sortMetric',e.sortMetric,[['brightness','亮度'],['hue','色相']],'effects')+r('下限阈值','sortLow',0,1,.01)+r('上限阈值','sortHigh',0,1,.01)+`<label class="check-option"><input type="checkbox" data-scope="effects" data-key="sortReverse" ${e.sortReverse?'checked':''}>降序</label>`)+
 b('噪波置换','displace',r('偏移, px','displaceAmount',0,100)+r('噪波尺度, px','displaceSize',4,200)+seed('displaceSeed',e.displaceSeed,'effects'))+
 b('故障条带','glitch',r('条带高度, px','glitchSize',1,120)+r('偏移, px','glitchAmount',0,200)+r('覆盖比例','glitchCoverage',0,1,.01)+r('RGB 分离, px','glitchRGB',0,40)+seed('glitchSeed',e.glitchSeed,'effects'))+
 b('定向模糊','blur',r('长度, px','blurLength',0,100)+r('方向, °','blurAngle',0,360)+r('采样数','blurSamples',2,24))+
 `<div class="fx-divider">光线与颜色</div>`+
 b('泛光','bloom',r('阈值','threshold',0,1,.01)+r('强度','strength',0,2,.05)+r('半径, px','radius',1,80))+
 b('色差','chromatic',r('方向偏移, px','aberration',0,40)+r('方向, °','angle',0,360)+r('径向偏移, px','radial',0,80))+
 b('反相','invert','')+
 b('色相偏移','hueShift',r('色相偏移, °','hueShiftAngle',-180,180))+
 `<div class="fx-divider">印刷与纹理</div>`+
 b('半调','halftone',r('网点尺寸, px','halftoneSize',2,40)+r('网屏角度, °','halftoneAngle',0,90)+r('对比度','halftoneContrast',.1,3,.05)+color('网点颜色','halftoneInk',e.halftoneInk)+color('纸张颜色','halftonePaper',e.halftonePaper))+
 b('抖动','dither',r('每通道级数','ditherLevels',2,8)+r('抖动强度','ditherAmount',0,1,.01))+
 b('阈值','cutoff',r('截断点','cutoffLevel',0,1,.01)+color('亮部颜色','cutoffInk',e.cutoffInk)+color('暗部颜色','cutoffPaper',e.cutoffPaper))+
 b('色调分离','posterize',r('每通道级数','posterizeLevels',2,16))+
 b('像素 / CRT 显示','crt',r('像素尺寸, px','crtPixelSize',1,32)+r('扫描线','crtScanlines',0,1,.01)+r('RGB 掩膜','crtMask',0,1,.01)+r('锐化','crtSharpen',0,3,.05)+r('暗角','crtVignette',0,1,.01))+
 b('颗粒','grain',r('强度','grainAmount',0,1,.01)+r('尺寸, px','grainSize',1,8,.25)+seed('grainSeed',e.grainSeed,'effects','颗粒种子'));
}
