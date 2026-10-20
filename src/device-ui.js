/** Screen size avoids treating a narrowed touch laptop window as a phone. */
export function isSmartphone({screenWidth,screenHeight,touchPoints=0,coarsePointer=false}) {
  const short=Math.min(screenWidth,screenHeight),long=Math.max(screenWidth,screenHeight);
  return (touchPoints>0||coarsePointer) && short>0 && short<=540 && long<=1100;
}
export function smartphoneUI() {
  return isSmartphone({screenWidth:screen.width,screenHeight:screen.height,touchPoints:navigator.maxTouchPoints,coarsePointer:matchMedia('(pointer: coarse)').matches});
}
