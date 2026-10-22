/**
 * CSSのスクロール連動アニメーションが利用できるか判定する
 */
export function supportsScrollDrivenAnimations() {
  return (
    typeof CSS !== 'undefined' &&
    CSS.supports('animation-timeline: scroll()')
  );
}
