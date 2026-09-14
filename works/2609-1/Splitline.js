(() => {
const splitlineRoot = document.getElementById("splitline-work");
if (!splitlineRoot) return;
let splitUI;
(()=>{
const defaults={bg:'#ffffff',surface:'#ffffff',track:'#ebebeb',fill:'#d4d4d4',ink:'#333333',text:'#4a4a4a',accent:'#333333',line:'#dddddd',radius:21};
let theme={...defaults};const radius=splitlineRoot.querySelector('#' + 'radius-control');
function apply(next){
 const updated={...theme};
 for(const key of Object.keys(defaults))if(key in next){
  if(key==='radius'){const n=Number(next.radius);if(Number.isFinite(n))updated.radius=Math.max(0,Math.min(28,n));}
  else if(/^#[0-9a-f]{6}$/i.test(next[key]))updated[key]=next[key];
 }
 theme=updated;
 for(const [key,value] of Object.entries(theme))splitlineRoot.style.setProperty('--'+key,key==='radius'?value+'px':value);
 radius.value=theme.radius;
 splitlineRoot.querySelectorAll('[data-token]').forEach(el=>{el.value=theme[el.dataset.token]});
 splitlineRoot.dispatchEvent(new CustomEvent('splitui:themechange',{detail:{...theme}}));
}
splitUI={getTheme:()=>({...theme}),setTheme(next){apply(next);radius.dispatchEvent(new Event('input'));},resetTheme(){this.setTheme(defaults)}};
radius.addEventListener('input',()=>apply({radius:radius.value}));
splitlineRoot.querySelectorAll('[data-token]').forEach(el=>el.addEventListener('input',()=>apply({[el.dataset.token]:el.value})));
const resetState = () => splitlineRoot.dispatchEvent(new CustomEvent('splitui:reset-state'));
splitlineRoot.querySelector('#reset-all').addEventListener('click', () => {
 splitUI.resetTheme();
 resetState();
});
apply(defaults);
})();

function initSplitSlider(scope, { alwaysSplit = false, input = null, max = 100, suffix = '' } = {}) {

    const slider = scope.querySelector('[data-ref="slider"]');
    const trackFill = scope.querySelector('[data-ref="trackFill"]');
    const valueDisplay = scope.querySelector('[data-ref="valueDisplay"]');
    const labelEl = scope.querySelector('[data-ref="label"]');
    const handleGroup = scope.querySelector('[data-ref="handleGroup"]');
    const paths = [scope.querySelector('[data-ref="handleTop"]'), scope.querySelector('[data-ref="handleBottom"]')];
    const radiusControl = splitlineRoot.querySelector('#' + 'radius-control');
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const mix = (a, b, t) => a + (b - a) * t;
    const smooth = t => { t = clamp(t, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };
    const inset = 3;
    const halfLength = 11;
    let value = input ? Number(input.value) : 50;
    let displayed = value;
    let pointerId = null;
    let frame = 0;
    let lastTime = 0;
    let geometry;

    function measure() {
      const box = slider.getBoundingClientRect();
      const label = labelEl.getBoundingClientRect();
      const number = valueDisplay.getBoundingClientRect();
      geometry = {
        width: box.width, height: box.height,
        radius: Math.min(parseFloat(getComputedStyle(slider).borderTopLeftRadius) || 0, box.height / 2, box.width / 2),
        labelRight: label.right - box.left,
        valueLeft: number.left - box.left
      };
      handleGroup.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
      render();
    }

    // Arc-length coordinates along the inset outline, starting at the left midpoint.
    // Mirroring this rail yields the other three quadrants without separate cases.
    function outlinePoint(distance, r = Math.max(0, geometry.radius - inset)) {
      const {height} = geometry;
      const vertical = height / 2 - inset - r;
      const arcLength = Math.PI * r / 2;
      if (distance <= vertical) return [inset, height / 2 - distance];
      if (r > 0 && distance < vertical + arcLength) {
        const angle = (distance - vertical) / r;
        return [inset + r * (1 - Math.cos(angle)), inset + r * (1 - Math.sin(angle))];
      }
      return [inset + r + distance - vertical - arcLength, inset];
    }

    function render() {
      if (!geometry) return;
      if (input) {
        slider.style.setProperty('--radius', displayed + 'px');
        geometry.radius = Math.min(displayed, geometry.height / 2, geometry.width / 2);
      }
      const {width, height, radius, labelRight, valueLeft} = geometry;
      const x = mix(inset, width - inset, displayed / max);
      const r = Math.max(0, radius - inset);
      // Fit the inner turn above/below a full half-handle. A larger radius
      // would push its vertical extension through the center and overlap the
      // other half, making the combined handle appear to shrink in a pill.
      const turnRadius = Math.min(r, Math.max(0, height / 2 - inset - halfLength));
      const textClearance = 3;
      const transitionDistance = turnRadius + halfLength / 2;
      const leftAmount = 1 - smooth((x - labelRight - textClearance) / transitionDistance);
      const rightAmount = 1 - smooth((valueLeft - x - textClearance) / transitionDistance);
      const right = alwaysSplit ? x > width / 2 : rightAmount > leftAmount;
      const amount = alwaysSplit ? 1 : Math.max(leftAmount, rightAmount);
      const edgeDistance = right ? width - inset - x : x - inset;
      const cornerLength = height / 2 - inset - r + Math.PI * r / 2;
      // Enough travel to clear the corner before becoming a straight horizontal bar.
      const run = Math.max(radius, halfLength);
      const endCenter = cornerLength + run - r;
      const center = edgeDistance < run
        ? halfLength / 2 + edgeDistance + (endCenter - halfLength / 2 - run) * smooth(edgeDistance / run)
        : cornerLength + edgeDistance - r;

      // Keep the inner corner fixed in the slider, just like the outer corner.
      // Each half starts on its own side of the midpoint, with no overlap.
      const verticalRail = height / 2 - inset - turnRadius;
      const turnLength = verticalRail + Math.PI * turnRadius / 2;
      const turnStart = halfLength / 2;
      const turnCenter = mix(turnStart, turnLength + halfLength / 2, amount);
      const turnAnchor = right
        ? valueLeft - textClearance - transitionDistance
        : labelRight + textClearance + transitionDistance;

      let handleLeft = Infinity;
      let handleRight = -Infinity;
      paths.forEach((path, index) => {
        const points = [];
        for (let i = 0; i <= 32; i++) {
          const t = i / 32;
          let px, py;
          if (amount === 0) {
            px = x;
            const [, startY] = outlinePoint(turnStart + (t - 0.5) * halfLength, turnRadius);
            py = index === 0 ? startY : height - startY;
          } else if (amount < 1) {
            const [turnPointX, turnPointY] = outlinePoint(turnCenter + (t - 0.5) * halfLength, turnRadius);
            px = turnAnchor + (right ? 1 : -1) * (turnPointX - inset);
            py = index === 0 ? turnPointY : height - turnPointY;
          } else {
            // Reverse the sample direction to meet the reflected inner turn.
            const [railX, railY] = outlinePoint(center + (0.5 - t) * halfLength);
            px = right ? width - railX : railX;
            py = index === 0 ? railY : height - railY;
          }
          handleLeft = Math.min(handleLeft, px);
          handleRight = Math.max(handleRight, px);
          points.push(`${i === 0 ? 'M' : 'L'}${px.toFixed(3)},${py.toFixed(3)}`);
        }
        path.setAttribute('d', points.join(' '));
      });
      // Follow the rendered stroke, in the same frame, without moving its path.
      // Near the outside edge only, smoothly reach an exactly empty/full fill.
      const handleCenter = (handleLeft + handleRight) / 2;
      const endHandleCenter = (inset + outlinePoint(halfLength)[0]) / 2;
      const endWeight = amount === 1
        ? 1 - smooth((center - halfLength / 2) / cornerLength)
        : 0;
      const fillX = clamp(handleCenter + (right ? 1 : -1) * endHandleCenter * endWeight, 0, width);
      trackFill.style.clipPath = `inset(0 ${width - fillX}px 0 0)`;
      valueDisplay.textContent = Math.round(displayed) + suffix;
    }

    // Smooth the position, then derive the entire shape from that same position.
    // Independent shape tweens can lag behind a fast drag and cross the text.
    function animate(time) {
      const dt = Math.min((time - (lastTime || time - 16)) / 1000, 0.05);
      lastTime = time;
      displayed = mix(displayed, value, 1 - Math.exp(-dt / 0.045));
      if (Math.abs(value - displayed) < 0.005) displayed = value;
      render();
      if (displayed !== value) frame = requestAnimationFrame(animate);
      else { frame = 0; lastTime = 0; }
    }

    function setValue(next) {
      value = clamp(next, 0, max);
      slider.setAttribute('aria-valuenow', Math.round(value));
      if (input) {
        input.value = value;
        slider.setAttribute('aria-valuetext', Math.round(value) + suffix);
        input.dispatchEvent(new Event('input'));
      }
      if (reducedMotion.matches) {
        cancelAnimationFrame(frame);
        frame = 0;
        lastTime = 0;
        displayed = value;
        render();
      } else if (!frame) frame = requestAnimationFrame(animate);
    }

    function setFromPointer(event) {
      const rect = slider.getBoundingClientRect();
      setValue((event.clientX - rect.left - inset) / (rect.width - 2 * inset) * max);
    }

    slider.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0 || pointerId !== null) return;
      pointerId = event.pointerId;
      slider.focus({preventScroll: true});
      slider.setPointerCapture(pointerId);
      setFromPointer(event);
    });
    slider.addEventListener('pointermove', event => {
      if (event.pointerId === pointerId) setFromPointer(event);
    });
    function release(event) {
      if (event.pointerId !== pointerId) return;
      pointerId = null;
      if (slider.hasPointerCapture(event.pointerId)) slider.releasePointerCapture(event.pointerId);
    }
    slider.addEventListener('pointerup', release);
    slider.addEventListener('pointercancel', release);
    slider.addEventListener('lostpointercapture', release);
    slider.addEventListener('keydown', event => {
      const step = event.shiftKey ? 5 : 1;
      const next = {ArrowLeft: value - step, ArrowDown: value - step,
        ArrowRight: value + step, ArrowUp: value + step, Home: 0, End: max}[event.key];
      if (next === undefined) return;
      event.preventDefault();
      setValue(next);
    });
    splitlineRoot.addEventListener('splitui:themechange', () => {
      if (input) {
        value = Number(input.value);
        slider.setAttribute('aria-valuenow', Math.round(value));
        slider.setAttribute('aria-valuetext', Math.round(value) + suffix);
        if (reducedMotion.matches) displayed = value;
        else if (!frame && displayed !== value) frame = requestAnimationFrame(animate);
      }
      slider.style.setProperty('--radius', `${radiusControl.value}px`);
      measure();
    });
    if (!input) splitlineRoot.addEventListener('splitui:reset-state', () => setValue(50));
    reducedMotion.addEventListener('change', () => setValue(value));
    new ResizeObserver(measure).observe(slider);
    document.fonts.ready.then(measure);
    measure();
  
}

initSplitSlider(splitlineRoot.querySelector('#' + 'branched-slider'), { alwaysSplit: true });
initSplitSlider(splitlineRoot.querySelector('#' + 'radius-slider'), {
  alwaysSplit: true, input: splitlineRoot.querySelector('#' + 'radius-control'), max: 28, suffix: ' px'
});

(()=>{
const root=splitlineRoot.querySelector('#' + 'contour-parts'),$=s=>root.querySelector(s),reduced=matchMedia('(prefers-reduced-motion: reduce)');
const mix=(a,b,t)=>a+(b-a)*t,clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const design={duration:260,get radius(){return splitUI.getTheme().radius;}};
const animations=new Map();
function motion(key,to,draw){let a=animations.get(key);if(!a){a={value:to,target:to,frame:0};animations.set(key,a)}a.target=to;a.draw=draw;if(reduced.matches){cancelAnimationFrame(a.frame);a.frame=0;a.value=to;draw(to);return}if(a.frame)return;let previous=0;function tick(time){const dt=Math.min(time-(previous||time-16),40);previous=time;a.value=mix(a.value,a.target,1-Math.exp(-dt/(design.duration/5)));if(Math.abs(a.value-a.target)<.001)a.value=a.target;a.draw(a.value);if(a.value!==a.target)a.frame=requestAnimationFrame(tick);else a.frame=0}a.frame=requestAnimationFrame(tick)}
// A shared fixed rounded outline. Every marker is a constant-length window
// along this outline; its center is never pulled toward the text.
function outline(w,h,r){r=Math.min(r,(w-6)/2,(h-6)/2);const x=3,y=3,W=w-6,H=h-6,hor=W-2*r,ver=H-2*r,arc=Math.PI*r/2;const lengths=[hor,arc,ver,arc,hor,arc,ver,arc],total=lengths.reduce((a,b)=>a+b,0);return {total,point(s){s=((s%total)+total)%total;let n=0;while(n<7&&s>lengths[n]){s-=lengths[n];n++}const t=r?s/r:0;switch(n){case 0:return[x+r+s,y];case 1:return[x+W-r+r*Math.sin(t),y+r-r*Math.cos(t)];case 2:return[x+W,y+r+s];case 3:return[x+W-r+r*Math.cos(t),y+H-r+r*Math.sin(t)];case 4:return[x+W-r-s,y+H];case 5:return[x+r-r*Math.sin(t),y+H-r+r*Math.cos(t)];case 6:return[x,y+H-r-s];default:return[x+r-r*Math.cos(t),y+r-r*Math.sin(t)]}}}}
const save=$('#control-save'),saveSVG=save.querySelector('svg');let hovered=false;
function drawSave(state){formState('save',saveSVG,state)}
function updateSave(){drawSave(save.dataset.done==='true'?3:hovered?1:0)}
save.addEventListener('pointerenter',()=>{hovered=true;updateSave()});save.addEventListener('pointerleave',()=>{hovered=false;updateSave()});save.addEventListener('focus',()=>{hovered=true;updateSave()});save.addEventListener('blur',()=>{hovered=false;updateSave()});save.addEventListener('click',()=>{const done=save.dataset.done!=='true';save.dataset.done=done;save.querySelector('span').textContent=done?'Following':'Follow';$('#control-save-status').textContent=done?'Following':'Follow';updateSave()});
const checkbox=$('#control-checkbox'),checkPaths=checkbox.nextElementSibling.querySelectorAll('path');
const choiceHover=new WeakMap();
function choicePoint(mark,i,u){
 const outer=parseFloat(getComputedStyle(mark).borderTopLeftRadius)||0,r=Math.max(0,Math.min(11,outer*28/mark.offsetWidth-3));
 const rail=outline(28,28,r),right=22-2*r+Math.PI*r/2+(22-2*r)/2;
 const corner=(22-2*r)/2+Math.PI*r/4,hover=choiceHover.get(mark)||0;
 // Slide and extend a window on the outline itself, preserving its curvature.
 // Left stays toward the top; the mirrored right marker stays toward the bottom.
 const side=22-2*r+Math.PI*r;
 const center=right+(i===0?rail.total/2:0)+mix(corner,side/4,hover);
 return rail.point(center+(u-.5)*mix(10,side/2,hover));
}
let checkRoutes;
function buildCheckRoutes(){
 const mark=checkbox.nextElementSibling,ends=[[[7,15],[12,20]],[[22,10],[12,20]]];
 return ends.map((end,i)=>{
  const nodes=Array.from({length:33},(_,n)=>choicePoint(mark,i,1-n/32)),lengths=[0];
  if(i===1){
   // The lower-right stroke travels up the outline before entering the check.
   const outer=parseFloat(getComputedStyle(mark).borderTopLeftRadius)||0,r=Math.max(0,Math.min(11,outer*28/mark.offsetWidth-3)),rail=outline(28,28,r);
   const right=22-2*r+Math.PI*r/2+(22-2*r)/2,corner=(22-2*r)/2+Math.PI*r/4,side=22-2*r+Math.PI*r,hover=choiceHover.get(mark)||0;
   const start=right+mix(corner,side/4,hover)-mix(10,side/2,hover)/2;
   for(let n=1;n<=32;n++)nodes.push(rail.point(mix(start,right-corner,n/32)));
  }
  const a=nodes.at(-1),prev=nodes.at(-2),tangent=[a[0]-prev[0],a[1]-prev[1]],tn=Math.hypot(...tangent)||1,dx=end[1][0]-end[0][0],dy=end[1][1]-end[0][1],len=Math.hypot(dx,dy);
  const bend=Math.min(3,Math.hypot(a[0]-end[0][0],a[1]-end[0][1])/3),b=[a[0]+tangent[0]/tn*bend,a[1]+tangent[1]/tn*bend],c=[end[0][0]-dx/len*bend,end[0][1]-dy/len*bend];
  for(let n=1;n<24;n++){const u=n/24,v=1-u;nodes.push([v*v*v*a[0]+3*v*v*u*b[0]+3*v*u*u*c[0]+u*u*u*end[0][0],v*v*v*a[1]+3*v*v*u*b[1]+3*v*u*u*c[1]+u*u*u*end[0][1]])}
  nodes.push(...end);for(let n=1;n<nodes.length;n++)lengths.push(lengths[n-1]+Math.hypot(nodes[n][0]-nodes[n-1][0],nodes[n][1]-nodes[n-1][1]));
  const initial=lengths[32],total=lengths.at(-1),final=Math.hypot(end[1][0]-end[0][0],end[1][1]-end[0][1]);
  function point(s){let n=1;while(n<lengths.length-1&&lengths[n]<s)n++;const u=(s-lengths[n-1])/(lengths[n]-lengths[n-1]||1);return [mix(nodes[n-1][0],nodes[n][0],u),mix(nodes[n-1][1],nodes[n][1],u)]}
  return {lengths,point,initial,total,final};
 });
}
function drawCheck(t){
 if(!checkRoutes)checkRoutes=buildCheckRoutes();
 checkPaths.forEach((path,i)=>{
  let points;
  if(t===0)points=Array.from({length:33},(_,n)=>choicePoint(checkbox.nextElementSibling,i,n/32));
  else {const route=checkRoutes[i],start=mix(0,route.total-route.final,t),end=mix(route.initial,route.total,t);points=(t===1?[start,end]:[start,...route.lengths.filter(s=>s>start+1e-6&&s<end-1e-6),end]).map(route.point)}
  path.setAttribute('d',points.map(([x,y],n)=>`${n?'L':'M'}${x.toFixed(3)},${y.toFixed(3)}`).join(' '));
 });
}
checkbox.addEventListener('change',()=>{const value=animations.get('check')?.value||0;if(value===0)checkRoutes=buildCheckRoutes();checkbox.parentElement.dataset.checkedHover=checkbox.parentElement.matches(':hover');motion('check',+checkbox.checked,drawCheck);$('#control-check-state').textContent=checkbox.checked?'On':'Off'});
function drawRadio(input,t){input.nextElementSibling.querySelectorAll('path').forEach((p,i)=>{const points=[];for(let n=0;n<=30;n++){const u=n/30,[x,y]=choicePoint(input.nextElementSibling,i,u),angle=(i===0?Math.PI/2:-Math.PI/2)+Math.PI*u;points.push(`${n?'L':'M'}${mix(x,14+3*Math.cos(angle),t)},${mix(y,14+3*Math.sin(angle),t)}`)}p.setAttribute('d',points.join(' '));p.style.strokeWidth=mix(2.5,6,t)})}
root.querySelectorAll('input[name="control-density"]').forEach(input=>input.addEventListener('change',()=>{$('#control-radio-state').textContent=input.value+' selected';root.querySelectorAll('input[name="control-density"]').forEach(r=>motion(r.value,+r.checked,t=>drawRadio(r,t)))}));
const toggle=$('#control-toggle'),toggleSVG=toggle.nextElementSibling.querySelector('svg');
function drawToggle(t,control=toggle,svg=toggleSVG){const w=control.nextElementSibling.clientWidth,h=control.nextElementSibling.clientHeight,r=Math.max(0,Math.min(h/2,splitUI.getTheme().radius)-3),L=11,right=t>.5,x=mix(3,w-3,t),edge=right?w-3-x:x-3,vertical=h/2-3-r,corner=vertical+Math.PI*r/2,run=r+3,end=corner+run-r;
svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
const center=edge<run?mix(L/2,end,edge/run):corner+edge-r;
function top(s){if(s<=vertical)return [3,h/2-s];if(r>0&&s<corner){const a=(s-vertical)/r;return [3+r*(1-Math.cos(a)),3+r*(1-Math.sin(a))]}return [3+r+s-corner,3]}
svg.querySelectorAll('path').forEach((p,i)=>{const points=[];for(let n=0;n<=30;n++){let [px,py]=top(center+(n/30-.5)*L);if(right)px=w-px;if(i)py=h-py;points.push(`${n?'L':'M'}${px.toFixed(3)},${py.toFixed(3)}`)}p.setAttribute('d',points.join(' '))})}
toggle.addEventListener('change',()=>{motion('toggle',+toggle.checked,drawToggle);$('#control-toggle-state').textContent=toggle.checked?'On':'Off'});
// Invert the same arc-length mapping as drawToggle to land at the corner midpoint.
function toggleHoverValue(){
 const shell=toggle.nextElementSibling,w=shell.clientWidth,h=shell.clientHeight;
 const radius=Math.min(parseFloat(getComputedStyle(shell).borderTopLeftRadius)||0,h/2,w/2),r=Math.max(0,radius-3);
 const vertical=h/2-3-r,arc=Math.PI*r/2,run=r+3,end=vertical+arc+run-r;
 const target=Math.max(5.5,vertical+arc/2),edge=clamp((target-5.5)/(end-5.5)*run,0,run);
 const fraction=edge/(w-6);return toggle.checked?1-fraction:fraction;
}
let togglePreview=false;
function previewToggle(){togglePreview=true;motion('toggle',toggleHoverValue(),drawToggle)}
toggle.parentElement.addEventListener('pointerenter',previewToggle);
toggle.parentElement.addEventListener('pointerleave',()=>{togglePreview=false;motion('toggle',+toggle.checked,drawToggle)});
toggle.addEventListener('focus',previewToggle);
toggle.addEventListener('blur',()=>{togglePreview=false;motion('toggle',+toggle.checked,drawToggle)});
const field=$('#control-text'),fieldSVG=field.nextElementSibling;
// Blend state weights so interrupted transitions go directly to the new shape.
const formWeights=new Map();
const formRotations=new WeakMap();
function drawForm(svg,weights){
 const w=svg.parentElement.clientWidth,h=svg.parentElement.clientHeight;
 const stroke=3,outer=Math.min(design.radius,h/2,w/2),baseR=Math.max(0,outer-3);
 const corner=(h/2-3-baseR)+Math.PI*baseR/4;
 // Keep a 3px centerline inset (1.5px visible clearance) in every state.
 const pad=3;
 const r=Math.max(0,outer-pad),W=w-2*pad,H=h-2*pad,hor=W-2*r,ver=H-2*r,arc=Math.PI*r/2;
 const rail=outline(w-2*pad+6,h-2*pad+6,r),right=hor+arc+ver/2,left=right+rail.total/2;
 const full=ver+2*arc,half=full/2;
 const len=weights[0]*11+weights[1]*(half-stroke/2)+weights[2]*full+weights[3]*22;
 const hoverOffset=full/2-(half-stroke/2)/2;
 svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
 svg.querySelectorAll('path').forEach((path,i)=>{
  const center=(i===0?left:right)+weights[0]*corner+weights[1]*hoverOffset+(formRotations.get(svg)||0)*rail.total,points=[];
  for(let n=0;n<=32;n++){const [x,y]=rail.point(center+(n/32-.5)*len);points.push(`${n?'L':'M'}${(x+pad-3).toFixed(3)},${(y+pad-3).toFixed(3)}`)}path.setAttribute('d',points.join(' '));
 });
}
function formState(key,svg,state){
 if(!formWeights.has(key))formWeights.set(key,[1,0,0,0]);
 const weights=formWeights.get(key);
 weights.forEach((value,i)=>{const name=key+'-shape-'+i,draw=v=>{weights[i]=v;drawForm(svg,weights)};if(!animations.has(name))animations.set(name,{value,target:value,frame:0,draw});motion(name,+(i===state),draw)});
}
let fieldHovered=false,fieldFocused=false,fieldConfirmed=false;
function updateField(){formState('field',fieldSVG,fieldConfirmed?3:fieldFocused?2:fieldHovered?1:0)}
function confirmField(){fieldConfirmed=!!field.value.trim();$('#control-field-state').textContent=fieldConfirmed?'Input confirmed':'Empty';updateField()}
field.parentElement.addEventListener('pointerenter',()=>{fieldHovered=true;updateField()});field.parentElement.addEventListener('pointerleave',()=>{fieldHovered=false;updateField()});
field.addEventListener('focus',()=>{fieldFocused=true;fieldConfirmed=false;updateField()});
field.addEventListener('blur',()=>{fieldFocused=false;confirmField()});
function sizeField(){field.style.height='0px';const height=Math.max(42,field.scrollHeight);field.parentElement.style.height=height+'px';field.closest('.control-field').style.height=height+'px';field.style.height='100%';if(formWeights.has('field'))drawForm(fieldSVG,formWeights.get('field'))}
field.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&!e.isComposing){e.preventDefault();confirmField()}});
field.addEventListener('input',()=>{sizeField();fieldConfirmed=false;updateField();$('#control-field-state').textContent=field.value?'Editing · '+field.value.length+' / '+field.maxLength:'Empty'});
const trigger=$('#control-dropdown-trigger'),options=$('#control-options'),dropSVG=trigger.querySelector('svg');
const dropPanel=document.createElement('div'),dropInner=document.createElement('div');dropPanel.className='control-panel';dropPanel.dataset.open=false;options.before(dropPanel);dropPanel.appendChild(dropInner);dropInner.appendChild(options);
// Keep content laid out inside the collapsed grid, just like the accordion.
options.hidden=false;dropPanel.inert=true;dropPanel.setAttribute('aria-hidden','true');
let dropHovered=false,dropFocused=false,dropConfirmed=false;
function updateDrop(){formState('drop',dropSVG,trigger.getAttribute('aria-expanded')==='true'?2:dropConfirmed?3:(dropHovered||dropFocused)?1:0)}
trigger.addEventListener('pointerenter',()=>{dropHovered=true;updateDrop()});trigger.addEventListener('pointerleave',()=>{dropHovered=false;updateDrop()});
trigger.addEventListener('focus',()=>{dropFocused=true;updateDrop()});trigger.addEventListener('blur',()=>{dropFocused=false;updateDrop()});
function setOpen(open,focus=false){trigger.setAttribute('aria-expanded',open);dropPanel.dataset.open=open;dropPanel.inert=!open;dropPanel.setAttribute('aria-hidden',!open);$('#control-dropdown-state').textContent=open?'Choose an option':dropConfirmed?$('#control-selected').textContent+' selected':'Closed';updateDrop();if(open&&focus)options.querySelector('[aria-pressed="true"]').focus()}
trigger.addEventListener('click',()=>setOpen(trigger.getAttribute('aria-expanded')!=='true'));trigger.addEventListener('keydown',e=>{if(e.key==='ArrowDown'){e.preventDefault();setOpen(true,true)}});
options.querySelectorAll('button').forEach((b,i)=>{b.addEventListener('click',()=>{options.querySelectorAll('button').forEach(o=>o.setAttribute('aria-pressed',o===b));$('#control-selected').textContent=b.dataset.value;dropConfirmed=true;setOpen(false);trigger.focus()});b.addEventListener('keydown',e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const buttons=[...options.querySelectorAll('button')];buttons[(i+(e.key==='ArrowDown'?1:buttons.length-1))%buttons.length].focus()}})});
root.addEventListener('keydown',e=>{if(e.key==='Escape'&&trigger.getAttribute('aria-expanded')==='true'){setOpen(false);trigger.focus()}});root.addEventListener('pointerdown',e=>{if(!e.target.closest('.control-dropdown')&&trigger.getAttribute('aria-expanded')==='true')setOpen(false)});
function reset(){save.dataset.done='false';save.querySelector('span').textContent='Follow';$('#control-save-status').textContent='Follow';hovered=false;updateSave();checkbox.checked=false;checkbox.dispatchEvent(new Event('change'));toggle.checked=false;toggle.dispatchEvent(new Event('change'));const radio=root.querySelector('input[name="control-density"]');radio.checked=true;radio.dispatchEvent(new Event('change'));field.value='';$('#control-field-state').textContent='Empty';formState('field',fieldSVG,0);$('#control-selected').textContent='All layers';options.querySelectorAll('button').forEach((b,i)=>b.setAttribute('aria-pressed',i===0));setOpen(false)}
splitlineRoot.addEventListener('splitui:reset-state',()=>{togglePreview=false;fieldHovered=fieldFocused=fieldConfirmed=dropHovered=dropFocused=dropConfirmed=false;reset()});
[['check',0,drawCheck],['toggle',0,drawToggle]].forEach(([key,value,draw])=>{animations.set(key,{value,target:value,frame:0,draw});draw(value)});
updateSave();formState('field',fieldSVG,0);formState('drop',dropSVG,0);
root.querySelectorAll('input[name="control-density"]').forEach(r=>{const draw=t=>drawRadio(r,t);animations.set(r.value,{value:+r.checked,target:+r.checked,frame:0,draw});draw(+r.checked)});
root.querySelectorAll('.control-choice input').forEach((input,index)=>{
 const mark=input.nextElementSibling,key='choice-hover-'+index,draw=v=>{choiceHover.set(mark,v);if(input===checkbox)drawCheck(animations.get('check')?.value||0);else drawRadio(input,animations.get(input.value)?.value||0)};
 animations.set(key,{value:0,target:0,frame:0,draw});
 input.parentElement.addEventListener('pointerenter',()=>motion(key,1,draw));input.parentElement.addEventListener('pointerleave',()=>{if(input===checkbox)delete input.parentElement.dataset.checkedHover;motion(key,0,draw)});input.addEventListener('focus',()=>motion(key,1,draw));input.addEventListener('blur',()=>motion(key,0,draw));
});
splitlineRoot.addEventListener('splitui:reset-state',sizeField);
let fieldWidth=0;new ResizeObserver(entries=>{const width=entries[0].contentRect.width;if(width!==fieldWidth){fieldWidth=width;sizeField()}}).observe(field.parentElement);document.fonts.ready.then(sizeField);
const three=$('#control-segment-four'),threeButtons=[...three.querySelectorAll('button')];let threeSelected=0;
function drawThree(t){const index=clamp(t,0,1)*(threeButtons.length-1),lo=Math.floor(index),hi=Math.min(lo+1,threeButtons.length-1),w=three.clientWidth;const position=i=>i===0?0:i===threeButtons.length-1?1:((i+.5)*w/threeButtons.length-3)/(w-6);drawToggle(mix(position(lo),position(hi),index-lo),{nextElementSibling:three},three.querySelector('svg'))}
three.style.setProperty('--item-count',threeButtons.length);
function selectThree(i){threeSelected=i;three.style.setProperty('--selected-index',i);threeButtons.forEach((b,n)=>b.setAttribute('aria-pressed',n===i));$('#control-three-state').textContent=threeButtons[i].textContent+' selected';motion('three',i/(threeButtons.length-1),drawThree)}
threeButtons.forEach((b,i)=>{b.addEventListener('click',()=>selectThree(i));b.addEventListener('pointerenter',()=>motion('three',i/(threeButtons.length-1),drawThree));b.addEventListener('keydown',e=>{let next;if(e.key==='ArrowRight')next=(i+1)%threeButtons.length;if(e.key==='ArrowLeft')next=(i+threeButtons.length-1)%threeButtons.length;if(e.key==='Home')next=0;if(e.key==='End')next=threeButtons.length-1;if(next!==undefined){e.preventDefault();selectThree(next);threeButtons[next].focus()}})});
three.addEventListener('pointerleave',()=>motion('three',threeSelected/(threeButtons.length-1),drawThree));
const accordion=$('#control-accordion-trigger'),tag=$('#control-tag'),restore=$('#control-tag-restore');let tagTimer;
function outlineSymbol(svg,t,length=18){
 const w=svg.parentElement.clientWidth,h=svg.parentElement.clientHeight,r=Math.max(0,Math.min(design.radius,w/2,h/2)-3);
 if(w<=6||h<=6)return;
 const key=[w,h,r].join(',');
 if(outlineSymbol.cache?.key!==key){
  const rail=outline(w,h,r),hor=w-6-2*r,ver=h-6-2*r,arc=Math.PI*r/2;
  const routes=[0,1].map(i=>{
   const origin=[w/2,h/2],axis=i===0?[1,0]:[0,-1];
   const start=i===0?hor+arc+ver/2:hor/2;
   const cornerDistance=(i===0?ver:hor)/2+arc/2;
   const corner=rail.point(start-cornerDistance);
   const diagonal=[origin[0]-corner[0],origin[1]-corner[1]],diagonalLength=Math.hypot(...diagonal);
   const direction=diagonal.map(v=>v/diagonalLength);
   const trim=Math.min(r*.25,3,cornerDistance/3,diagonalLength/3);
   const nodes=[[origin[0]-axis[0]*9,origin[1]-axis[1]*9],rail.point(start)];
   // Horizontal: right, then up. Vertical: up, then left.
   for(let n=1;n<=64;n++)nodes.push(rail.point(start-(cornerDistance-trim)*n/64));
   const a=nodes[nodes.length-1],b=[corner[0]+direction[0]*trim,corner[1]+direction[1]*trim];
   // A fixed bend at the corner joins the outline to the final diagonal.
   if(trim>0)for(let n=1;n<=24;n++){const u=n/24;nodes.push([(1-u)**2*a[0]+2*(1-u)*u*corner[0]+u*u*b[0],(1-u)**2*a[1]+2*(1-u)*u*corner[1]+u*u*b[1]])}
   nodes.push([origin[0]+direction[0]*9,origin[1]+direction[1]*9]);
   const lengths=[0];for(let n=1;n<nodes.length;n++)lengths.push(lengths[n-1]+Math.hypot(nodes[n][0]-nodes[n-1][0],nodes[n][1]-nodes[n-1][1]));
   const total=lengths[lengths.length-1];
   function point(distance){let n=1;while(n<lengths.length-1&&lengths[n]<distance)n++;const u=(distance-lengths[n-1])/(lengths[n]-lengths[n-1]||1);return [mix(nodes[n-1][0],nodes[n][0],u),mix(nodes[n-1][1],nodes[n][1],u)]}
   return {point,lengths,total};
  });
  outlineSymbol.cache={key,routes};
 }
 svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
 const phase=((t%2)+2)%2,returning=phase>1,progress=returning?phase-1:phase;
 svg.querySelectorAll('path').forEach((path,i)=>{
  const route=outlineSymbol.cache.routes[i],center=mix(9,route.total-9,progress),start=center-length/2,end=center+length/2;
  // Continue through the lower corners on the return leg, never rewind the top leg.
  const lengths=returning?route.lengths.map(s=>route.total-s).reverse():route.lengths;
  const point=s=>{const [x,y]=route.point(returning?route.total-s:s);return returning?[w-x,h-y]:[x,y]};
  // Both ends move by the same arc distance; no shape tween or sideways shift.
  const samples=[start,...lengths.filter(s=>s>start&&s<end),end];
  path.setAttribute('d',samples.map((s,n)=>{const [x,y]=point(s);return `${n?'L':'M'}${x.toFixed(3)},${y.toFixed(3)}`}).join(' '));
 });
}
// Shared controller for 09 and the flush end controls: identical routes and timing.
function contourControl(key,button,initial,renderer=outlineSymbol,{latestOnly=false,resolveDestination=null}={}){
 const svg=button.querySelector('svg'),a={value:initial,target:initial,frame:0,destination:initial,length:18,moving:false,restored:false,hovered:false,focused:false};
 const draw=()=>renderer(svg,a.value,a.length);a.draw=draw;animations.set(key,a);
 const sizeKey=key+'-length',sizeDraw=v=>{a.length=v;draw()};
 animations.set(sizeKey,{value:18,target:18,frame:0,draw:sizeDraw});
 function resize(){if(!a.moving)motion(sizeKey,!a.restored&&(a.hovered||a.focused)?11:18,sizeDraw)}
 function go(state,complete){
  if(resolveDestination)a.destination=resolveDestination(state,a.value);
  else if(latestOnly)a.destination=state;
  else if(a.destination%2!==state)a.destination++;
  if(resolveDestination&&a.target===a.destination)return;
  const target=a.destination,size=animations.get(sizeKey);
  cancelAnimationFrame(a.frame);cancelAnimationFrame(size.frame);size.frame=0;a.target=target;a.moving=true;
  const finish=()=>{a.frame=0;a.moving=false;a.restored=true;size.value=a.length;resize();if(complete)complete()};
  if(reduced.matches){a.value=target;a.length=18;draw();finish();return}
  const from=a.value,length=a.length,shrink=Math.abs(length-11)>.01?100:0,duration=Math.max(100,design.duration*2.4*Math.abs(target-from));let start;
  function tick(time){
   if(start===undefined)start=time;const elapsed=time-start;
   if(elapsed<shrink){const u=elapsed/shrink;a.length=mix(length,11,u*u*(3-2*u));size.value=a.length;draw();a.frame=requestAnimationFrame(tick);return}
   a.length=size.value=11;const u=Math.min(1,(elapsed-shrink)/duration);a.value=mix(from,target,u*u*(3-2*u));draw();if(u<1)a.frame=requestAnimationFrame(tick);else finish();
  }
  a.frame=requestAnimationFrame(tick);
 }
 function reset(state){cancelAnimationFrame(a.frame);const size=animations.get(sizeKey);cancelAnimationFrame(size.frame);a.value=a.target=a.destination=state;a.frame=size.frame=0;a.length=size.value=18;a.moving=a.hovered=a.focused=false;a.restored=true;svg.style.opacity=1;draw()}
 function shrink(complete){
  cancelAnimationFrame(a.frame);const size=animations.get(sizeKey);cancelAnimationFrame(size.frame);size.frame=0;a.moving=true;const length=a.length;let start;
  function tick(time){if(start===undefined)start=time;const u=reduced.matches?1:Math.min(1,(time-start)/design.duration);a.length=size.value=length*(1-u*u*(3-2*u));svg.style.opacity=Math.min(1,a.length/3);draw();if(u<1)a.frame=requestAnimationFrame(tick);else{a.frame=0;complete()}}
  a.frame=requestAnimationFrame(tick);
 }
 button.addEventListener('pointerenter',()=>{a.hovered=true;a.restored=false;resize()});
 button.addEventListener('pointerleave',()=>{a.hovered=a.focused=false;resize()});
 button.addEventListener('pointerdown',()=>{a.focused=false;resize()});
 button.addEventListener('focus',()=>{a.focused=button.matches(':focus-visible');a.restored=false;resize()});
 button.addEventListener('blur',()=>{a.focused=false;resize()});
 draw();return {go,reset,shrink};
}
// Opening uses the upper corners; closing continues through the lower corners.
// Resolve from the current position so rapid clicks do not queue extra cycles.
const accordionControl=contourControl('accordion',accordion,0,outlineSymbol,{resolveDestination(state,current){
 const next=Math.ceil(current);
 return next%2===state?next:next+1;
}}),tagControl=contourControl('tag',tag.querySelector('button'),1);
save.addEventListener('click',()=>{save.dataset.hoverLock=save.matches(':hover')});
save.addEventListener('pointerleave',()=>{delete save.dataset.hoverLock});
function setAccordion(open){accordion.setAttribute('aria-expanded',open);$('#control-panel').dataset.open=open;$('#control-panel').setAttribute('aria-hidden',!open);$('#control-accordion-state').textContent=open?'Open':'Closed';accordionControl.go(+open)}
accordion.addEventListener('click',()=>setAccordion(accordion.getAttribute('aria-expanded')!=='true'));
function restoreTag(){clearTimeout(tagTimer);const appearing=tag.hidden;tag.hidden=false;tag.dataset.removing=false;tag.dataset.appearing=appearing;tag.querySelector('button').disabled=false;restore.hidden=true;$('#control-tag-state').textContent='Tag added';tagControl.reset(1)}
tag.querySelector('button').addEventListener('click',()=>{
 tag.querySelector('button').disabled=true;
 tag.dataset.appearing=false;tagControl.shrink(()=>{tag.dataset.removing=true;tagTimer=setTimeout(()=>{tag.hidden=true;tagTimer=setTimeout(restoreTag,1200)},reduced.matches?0:design.duration)});
});
restore.addEventListener('click',()=>{restoreTag();tag.querySelector('button').focus()});
animations.set('three',{value:0,target:0,frame:0,draw:drawThree});drawThree(0);
splitlineRoot.addEventListener('splitui:reset-state',()=>{selectThree(0);setAccordion(false);accordionControl.reset(0);restoreTag()});
const menu=$('#control-menu'),menuPanel=$('#control-menu-panel');
function menuSymbol(svg,t,length=18){
 const w=svg.parentElement.clientWidth,h=svg.parentElement.clientHeight,r=Math.max(0,Math.min(design.radius,w/2,h/2)-3);
 if(w<=6||h<=6)return;
 const key=[w,h,r].join(',');
 if(menuSymbol.cache?.key!==key){
  const rail=outline(w,h,r),ver=h-6-2*r,arc=Math.PI*r/2,right=w-6-2*r+arc+ver/2,left=right+rail.total/2;
  const offset=6<=ver/2?6:ver/2+r*Math.asin(Math.min(1,(6-ver/2)/r));
  const makeRoute=nodes=>{
   const lengths=[0];for(let n=1;n<nodes.length;n++)lengths.push(lengths[n-1]+Math.hypot(nodes[n][0]-nodes[n-1][0],nodes[n][1]-nodes[n-1][1]));
   const total=lengths[lengths.length-1];
   function point(s){let n=1;while(n<lengths.length-1&&lengths[n]<s)n++;const u=(s-lengths[n-1])/(lengths[n]-lengths[n-1]||1);return [mix(nodes[n-1][0],nodes[n][0],u),mix(nodes[n-1][1],nodes[n][1],u)]}
   return {point,lengths,total};
  };
  const routes=[0,1].map(i=>{
   const origin=[w/2,h/2],base=[w/2,h/2+(i?6:-6)],axis=-1;
   const start=left+(i?-offset:offset),end=left+(i?-1:1)*(ver/2+arc/2),sign=i?-1:1;
   const corner=rail.point(end),distance=Math.abs(end-start),diagonal=[origin[0]-corner[0],origin[1]-corner[1]],norm=Math.hypot(...diagonal),direction=diagonal.map(v=>v/norm);
   const trim=Math.min(r*.25,3,distance/3,norm/3),nodes=[[base[0]-axis*9,base[1]],rail.point(start)];
   for(let n=1;n<=64;n++)nodes.push(rail.point(start+sign*(distance-trim)*n/64));
   const a=nodes[nodes.length-1],b=[corner[0]+direction[0]*trim,corner[1]+direction[1]*trim];
   if(trim>0)for(let n=1;n<=24;n++){const u=n/24;nodes.push([(1-u)**2*a[0]+2*(1-u)*u*corner[0]+u*u*b[0],(1-u)**2*a[1]+2*(1-u)*u*corner[1]+u*u*b[1]])}
   nodes.push([origin[0]+direction[0]*9,origin[1]+direction[1]*9]);
   return makeRoute(nodes);
  });
  menuSymbol.cache={key,routes};
 }
 svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
 // Keep both resting equals signs: the original order at 0 / 4 and the
 // vertically swapped order at 2. This makes every repeated click continuous.
 const phase=((t%4)+4)%4,swapped=phase>=2,leg=phase%2,returning=leg>=1;
 svg.querySelectorAll('path').forEach((path,i)=>{
  const route=menuSymbol.cache.routes[swapped?1-i:i],progress=returning?leg-1:leg;
  const center=returning?mix(route.total-9,9,progress):mix(9,route.total-9,progress);
  const start=center-length/2,end=center+length/2;
  const samples=[start,...route.lengths.filter(s=>s>start&&s<end),end];
  // Mirror the opening guide horizontally to enter the diagonals from the right.
  // On return, the diagonals exit left into the opposite horizontal position.
  if(returning)samples.reverse();
  path.setAttribute('d',samples.map((s,n)=>{let [x,y]=route.point(s);if(returning)y=h-y;else x=w-x;return `${n?'L':'M'}${x.toFixed(3)},${y.toFixed(3)}`}).join(' '));
 });
}
// Follow the original forward route to the latest state, without queuing clicks.
const menuControl=contourControl('menu',menu,0,menuSymbol,{resolveDestination(state,current){
 const next=Math.ceil(current);
 return next%2===state?next:next+1;
}});
function setMenu(open){menu.setAttribute('aria-expanded',open);menu.setAttribute('aria-label',open?'Close menu':'Open menu');menuPanel.dataset.open=open;menuPanel.setAttribute('aria-hidden',!open);menuPanel.inert=!open;$('#control-menu-state').textContent=open?'Open':'Closed';menuControl.go(+open)}
menu.addEventListener('click',()=>setMenu(menu.getAttribute('aria-expanded')!=='true'));
menu.parentElement.addEventListener('keydown',e=>{if(e.key==='Escape'&&menu.getAttribute('aria-expanded')==='true'){e.preventDefault();menu.focus();setMenu(false)}});
menuPanel.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{menuPanel.querySelectorAll('button').forEach(item=>item.setAttribute('aria-pressed',item===b));menu.focus();setMenu(false);$('#control-menu-state').textContent=b.textContent+' selected'}));
splitlineRoot.addEventListener('splitui:reset-state',()=>{setMenu(false);menuControl.reset(0);menuPanel.querySelectorAll('button').forEach((b,i)=>b.setAttribute('aria-pressed',i===0))});
const loading=$('#control-loading'),loadingSVG=loading.querySelector('svg');let loadingFrame=0,loadingTimer=0,loadingHovered=false,loadingDone=false;
function updateLoading(){if(loading.getAttribute('aria-busy')!=='true'&&!loadingDone)formState('loading',loadingSVG,loadingHovered?1:0)}
function finishLoading(reset=false){cancelAnimationFrame(loadingFrame);clearTimeout(loadingTimer);loadingFrame=0;loading.disabled=false;loading.setAttribute('aria-busy','false');loading.querySelector('span').textContent=reset?'Load':'Loaded';$('#control-loading-state').textContent=reset?'Idle':'Loaded';loadingDone=!reset;loadingHovered=false;formRotations.set(loadingSVG,0);if(reset)updateLoading();else{formState('loading',loadingSVG,3);loadingTimer=setTimeout(()=>finishLoading(true),900)}}
loading.addEventListener('pointerenter',()=>{loadingHovered=true;updateLoading()});loading.addEventListener('pointerleave',()=>{loadingHovered=false;updateLoading()});
loading.addEventListener('focus',()=>{loadingHovered=true;updateLoading()});loading.addEventListener('blur',()=>{loadingHovered=false;updateLoading()});
function loadingProgress(t,initial,svg=loadingSVG,key='loading',loop=false){
 const ease=u=>{u=clamp(u,0,1);return u*u*u*(u*(u*6-15)+10)};
 const cycle=loop?Math.floor(t):0;
 if(loop)t-=cycle;
 const enter=ease(t/.18),settle=ease((t-.65)/.35);
 const weights=loop?[1,0,0,0]:initial.map((value,i)=>mix(mix(value,+(i===0),enter),+(i===3),settle));
 const w=svg.parentElement.clientWidth,h=svg.parentElement.clientHeight,r=Math.max(0,Math.min(design.radius,w/2,h/2)-3);
 const rail=outline(w,h,r),corner=h/2-3-r+Math.PI*r/4,full=h-6-2*r+Math.PI*r,hover=full/2-(full/2-1.5)/2;
 const startOffset=initial[0]*corner+initial[1]*hover,currentOffset=weights[0]*corner+weights[1]*hover;
 // The center travels monotonically counter-clockwise straight into its final position.
 // Compensate for changing shape so settling cannot reverse or restart the line.
 const center=loop?corner-2*rail.total*(cycle+ease(t)):mix(startOffset,-2*rail.total,ease(t));
 formRotations.set(svg,(center-currentOffset)/rail.total);
 formWeights.set(key,weights);
 weights.forEach((value,i)=>{const a=animations.get(key+'-shape-'+i);if(a)a.value=a.target=value});
 drawForm(svg,weights);
}
loading.addEventListener('click',()=>{
 clearTimeout(loadingTimer);loading.disabled=true;loading.setAttribute('aria-busy','true');loading.querySelector('span').textContent='Loading';$('#control-loading-state').textContent='Loading';loadingDone=false;let start;
 const initial=[...formWeights.get('loading')];initial.forEach((_,i)=>{const a=animations.get('loading-shape-'+i);cancelAnimationFrame(a.frame);a.frame=0});
 function tick(time){
  if(start===undefined)start=time;const t=Math.min(1,(time-start)/3200);
  loadingProgress(t,initial);
  if(t<1)loadingFrame=requestAnimationFrame(tick);else finishLoading();
 }
 if(!reduced.matches)loadingFrame=requestAnimationFrame(tick);else loadingTimer=setTimeout(()=>finishLoading(),3200);
});
formState('loading',loadingSVG,0);splitlineRoot.addEventListener('splitui:reset-state',()=>finishLoading(true));
const spinnerSVG=$('#control-spinner').querySelector('svg');
const spinnerAnimation={value:0,draw:t=>loadingProgress(t,[1,0,0,0],spinnerSVG,'spinner',true)};
animations.set('spinner-orbit',spinnerAnimation);
let spinnerFrame=0,spinnerPrevious=null;
function tickSpinner(time){
 if(spinnerPrevious!==null)spinnerAnimation.value+=Math.min(time-spinnerPrevious,50)/3200;
 spinnerPrevious=time;
 spinnerAnimation.draw(spinnerAnimation.value);
 spinnerFrame=requestAnimationFrame(tickSpinner);
}
function updateSpinnerMotion(){
 cancelAnimationFrame(spinnerFrame);
 spinnerFrame=0;spinnerPrevious=null;
 spinnerAnimation.draw(spinnerAnimation.value);
 if(!reduced.matches&&!document.hidden)spinnerFrame=requestAnimationFrame(tickSpinner);
}
reduced.addEventListener('change',updateSpinnerMotion);
document.addEventListener('visibilitychange',updateSpinnerMotion);
updateSpinnerMotion();
function genericProgress(t,initial,from,button,key,orbit){
 const ease=u=>{u=clamp(u,0,1);return u*u*u*(u*(u*6-15)+10)};
 const shrinkEnd=.35/1.35;
 const weights=initial.map((value,i)=>mix(value,+(i===0),ease(t/shrinkEnd)));
 const w=button.clientWidth,h=button.clientHeight,r=Math.max(0,Math.min(design.radius,w/2,h/2)-3);
 const rail=outline(w,h,r),corner=h/2-3-r+Math.PI*r/4,full=h-6-2*r+Math.PI*r,hover=full/2-(full/2-1.5)/2;
 const startOffset=initial[0]*corner+initial[1]*hover,currentOffset=weights[0]*corner+weights[1]*hover;
 const length=v=>v[0]*11+v[1]*(full/2-1.5)+v[2]*full+v[3]*22;
 const initialLength=length(initial),currentLength=length(weights);
 // Counter-clockwise travel: the leading end is center - length / 2.
 // Hold that end still while the trailing end catches up, then move the
 // complete short stroke along the outline into the opposite idle corner.
 const shrinkingCenter=startOffset-(initialLength-currentLength)/2;
 const shortCenter=startOffset-(initialLength-11)/2;
 const center=t<=shrinkEnd?shrinkingCenter:mix(shortCenter,corner-.5*rail.total,ease((t-shrinkEnd)/(1-shrinkEnd)));
 formWeights.set(key,weights);weights.forEach((v,i)=>{const a=animations.get(key+'-shape-'+i);a.value=a.target=v});
 orbit.value=from+(currentOffset-center)/rail.total;orbit.draw(orbit.value);
}
// Text and icon buttons share the same outline motion and independent state.
function initActionButton(button, key, status) {
 const svg = button.querySelector('.control-rail');
 let frame = 0;
 const orbit = {value: 0, draw(value) {
  formRotations.set(svg, -value);
  drawForm(svg, formWeights.get(key) || [1, 0, 0, 0]);
 }};
 formState(key, svg, 0);
 animations.set(key + '-orbit', orbit);
 orbit.draw(0);
 const hover = state => {
  if (button.getAttribute('aria-busy') !== 'true') formState(key, svg, state);
 };
 for (const [event, state] of [['pointerenter', 1], ['pointerleave', 0], ['focus', 1], ['blur', 0]]) {
  button.addEventListener(event, () => hover(state));
 }
 button.addEventListener('click', () => {
  if (button.getAttribute('aria-busy') === 'true') return;
  button.setAttribute('aria-busy', 'true');
  if (status) status.textContent = 'Running';
  let start;
  const from = orbit.value, initial = [...formWeights.get(key)];
  initial.forEach((_, i) => {
   const shape = animations.get(key + '-shape-' + i);
   cancelAnimationFrame(shape.frame);
   shape.frame = 0;
  });
  function tick(time) {
   if (start === undefined) start = time;
   const progress = reduced.matches ? 1 : Math.min(1, (time - start) / (design.duration * 1.35));
   genericProgress(progress, initial, from, button, key, orbit);
   if (progress < 1) frame = requestAnimationFrame(tick);
   else {
    frame = 0;
    button.setAttribute('aria-busy', 'false');
    if (status) status.textContent = 'Done';
   }
  }
  frame = requestAnimationFrame(tick);
 });
 splitlineRoot.addEventListener('splitui:reset-state', () => {
  cancelAnimationFrame(frame);
  frame = 0;
  orbit.value = 0;
  orbit.draw(0);
  button.setAttribute('aria-busy', 'false');
  formState(key, svg, 0);
  if (status) status.textContent = 'Idle';
 });
}
initActionButton($('#control-generic'), 'generic', $('#control-generic-state'));
initActionButton($('#control-text-button'), 'text-button', $('#control-text-button-state'));
initActionButton(splitlineRoot.querySelector('#reset-all'), 'reset-all', null);
splitlineRoot.querySelectorAll('.color-token').forEach((label, index) => {
 const input = label.querySelector('input');
 const svg = label.querySelector('.control-rail');
 const key = `theme-color-${index}`;
 let hovered = false, focused = false;
 const update = () => formState(key, svg, focused ? 2 : hovered ? 1 : 0);
 label.addEventListener('pointerenter', () => { hovered = true; update(); });
 label.addEventListener('pointerleave', () => { hovered = false; update(); });
 input.addEventListener('focus', () => { focused = true; update(); });
 input.addEventListener('blur', () => { focused = false; update(); });
 input.addEventListener('input', () => formState(key, svg, 3));
 splitlineRoot.addEventListener('splitui:reset-state', () => {
  hovered = focused = false;
  formState(key, svg, 0);
 });
 new ResizeObserver(update).observe(label);
 update();
});
const stepper=$('#control-stepper'),stepValue=stepper.querySelector('span[aria-live]');let step=1;
const stepButtons=[...stepper.querySelectorAll('button')];function updateStep(){stepValue.textContent=step;stepButtons[0].disabled=step===0}
const stepResets=[];
stepper.querySelectorAll('button').forEach((button,index)=>{
 const svg=button.querySelector('svg'),key='step-'+index;let frame=0,busy=false,target=0;
 const orbit={value:0,draw:v=>{formRotations.set(svg,-v);drawForm(svg,formWeights.get(key))}};formState(key,svg,0);animations.set(key+'-orbit',orbit);
 const hover=state=>{if(!busy)formState(key,svg,state)};button.addEventListener('pointerenter',()=>hover(1));button.addEventListener('pointerleave',()=>hover(0));button.addEventListener('focus',()=>hover(1));button.addEventListener('blur',()=>hover(0));
 function animateStep() {
  busy = true;
  const initial = [...formWeights.get(key)], from = orbit.value;
  const shrinkDuration = initial[0] > .999 ? 0 : design.duration * .35;
  initial.forEach((_, i) => {
   const shape = animations.get(key + '-shape-' + i);
   cancelAnimationFrame(shape.frame);
   shape.frame = 0;
  });
  let start, rotationStart;
  function tick(time) {
   if (start === undefined) start = time;
   const elapsed = time - start;
   if (!reduced.matches && elapsed < shrinkDuration) {
    genericProgress(elapsed / (design.duration * 1.35), initial, from, button, key, orbit);
   } else {
    if (rotationStart === undefined) {
     // Shrink only once; queued clicks extend one uninterrupted rotation.
     genericProgress(.35 / 1.35, initial, from, button, key, orbit);
     rotationStart = orbit.value;
    }
    orbit.value = reduced.matches ? target : Math.min(target,
     rotationStart + (elapsed - shrinkDuration) / design.duration * .5);
    orbit.draw(orbit.value);
   }
   if (orbit.value < target) frame = requestAnimationFrame(tick);
   else { frame = 0; busy = false; }
  }
  frame = requestAnimationFrame(tick);
 }
 button.addEventListener('click',()=>{
  if (button.disabled) return;
  step=Math.max(0,step+(index?1:-1));updateStep();
  target = (busy ? target : orbit.value) + .5;
  if(!busy)animateStep();
 });
 stepResets.push(()=>{cancelAnimationFrame(frame);frame=0;busy=false;target=0;orbit.value=0;orbit.draw(0);formState(key,svg,0)});
});
updateStep();splitlineRoot.addEventListener('splitui:reset-state',()=>{step=1;updateStep();stepResets.forEach(reset=>reset())});
function redraw(){root.style.setProperty('--control-radius',design.radius+'px');root.style.setProperty('--control-time',design.duration+'ms');if(togglePreview)motion('toggle',toggleHoverValue(),drawToggle);for(const a of animations.values())if(a.draw)a.draw(a.value)}
new ResizeObserver(redraw).observe(root);document.fonts.ready.then(redraw);
splitlineRoot.addEventListener('splitui:themechange',redraw);
redraw();
if(false){const tweak=new Tweak({container:root,onChange:redraw});tweak.addSlider(design,'duration',{label:'Motion speed',min:160,max:480,step:20,unit:'ms'});tweak.addSlider(design,'radius',{label:'Corner radius',min:8,max:22,step:1,unit:'px'});}
})();

})();
