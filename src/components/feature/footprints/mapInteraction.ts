export type MapPoint = {
  x: number;
  y: number;
};

export type MapRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type MapCamera = {
  scale: number;
  pan: MapPoint;
};

export function clampScale(value: number, min = 1, max = 4) {
  return Math.max(min, Math.min(max, value));
}

export function clientPointToViewBox(
  clientX: number,
  clientY: number,
  rect: MapRect,
  viewBoxWidth: number,
  viewBoxHeight: number,
): MapPoint {
  return {
    x: (clientX - rect.left) / Math.max(rect.width, 1) * viewBoxWidth,
    y: (clientY - rect.top) / Math.max(rect.height, 1) * viewBoxHeight,
  };
}

export function clampPan(
  pan: MapPoint,
  scale: number,
  viewBoxWidth: number,
  viewBoxHeight: number,
  edgeSlack = 0.12,
): MapPoint {
  if (scale <= 1) {
    return { x: 0, y: 0 };
  }

  const maxX = (scale - 1) * viewBoxWidth / 2 + viewBoxWidth * edgeSlack;
  const maxY = (scale - 1) * viewBoxHeight / 2 + viewBoxHeight * edgeSlack;

  return {
    x: Math.max(-maxX, Math.min(maxX, pan.x)),
    y: Math.max(-maxY, Math.min(maxY, pan.y)),
  };
}

export function zoomAtPoint(
  camera: MapCamera,
  nextScaleValue: number,
  pointer: MapPoint | null,
  viewBoxWidth: number,
  viewBoxHeight: number,
  maxScale: number,
): MapCamera {
  const nextScale = clampScale(nextScaleValue, 1, maxScale);

  if (nextScale === 1) {
    return {
      scale: 1,
      pan: { x: 0, y: 0 },
    };
  }

  if (!pointer) {
    return {
      scale: nextScale,
      pan: clampPan(camera.pan, nextScale, viewBoxWidth, viewBoxHeight),
    };
  }

  const currentTx = (1 - camera.scale) * viewBoxWidth / 2 + camera.pan.x;
  const currentTy = (1 - camera.scale) * viewBoxHeight / 2 + camera.pan.y;
  const worldX = (pointer.x - currentTx) / camera.scale;
  const worldY = (pointer.y - currentTy) / camera.scale;
  const nextTx = pointer.x - worldX * nextScale;
  const nextTy = pointer.y - worldY * nextScale;

  return {
    scale: nextScale,
    pan: clampPan({
      x: nextTx - (1 - nextScale) * viewBoxWidth / 2,
      y: nextTy - (1 - nextScale) * viewBoxHeight / 2,
    }, nextScale, viewBoxWidth, viewBoxHeight),
  };
}

export function isDragGesture(
  start: MapPoint,
  current: MapPoint,
  threshold = 5,
) {
  return Math.hypot(current.x - start.x, current.y - start.y) >= threshold;
}

