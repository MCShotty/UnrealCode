// Only embedded, bounded raster evidence. No remote requests or SVG execution.
export function evidenceImages(value:unknown):string[]{
 const images=new Set<string>();let visited=0
 function visit(value:unknown,depth:number){if(depth>10||visited++>3000||images.size>=6)return
  if(typeof value==='string'){
   if(value.length<=8*1024*1024&&/^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(value)){images.add(value);return}
   if(value.length<8*1024*1024&&value.startsWith('{')&&value.includes('unrealcode.browser.image'))try{visit(JSON.parse(value),depth+1)}catch{}
  }else if(Array.isArray(value)){for(const item of value)visit(item,depth+1)}else if(value&&typeof value==='object'){for(const item of Object.values(value))visit(item,depth+1)}
 }visit(value,0);return [...images]
}
export function evidenceText(value:unknown):string{return JSON.stringify(value,(_key,item)=>typeof item==='string'&&item.includes('data:image/')?'[Embedded image evidence]':item,2)}
