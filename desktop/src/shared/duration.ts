export function duration(value?: number): string {
  if(value===undefined||!Number.isFinite(value)||value<0)return 'Unknown'
  return value<1000?`${Math.round(value)} ms`:`${(value/1000).toFixed(1)} s`
}
