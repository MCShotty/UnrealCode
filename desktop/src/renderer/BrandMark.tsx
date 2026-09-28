import darkMark from '../../assets/brand/unrealcode-mark-dark.svg'
import lightMark from '../../assets/brand/unrealcode-mark-light.svg'

/** Decorative beside the product name; identical geometry in both themes. */
export function BrandMark({ className = '' }: { className?: string }) {
  return <span className={`brand-mark ${className}`} aria-hidden="true">
    <img className="brand-mark-dark" src={darkMark} alt="" draggable={false}/>
    <img className="brand-mark-light" src={lightMark} alt="" draggable={false}/>
  </span>
}
