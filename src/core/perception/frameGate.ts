import { ROIBox, ROIProposal, FrameAnalysisSnapshot } from "./attentionTypes";

const GRID_SIZE = 8;
const ROI_PADDING_RATIO = 0.12;
const MAX_ROI_BOXES = 3;
const MAX_COVERAGE_RATIO = 0.35;

export function buildFrameSnapshot(
  bitmap: Buffer,
  width: number,
  height: number
): FrameAnalysisSnapshot {
  const grayscale = new Uint8Array(width * height);
  const gridEnergy = new Array<number>(GRID_SIZE * GRID_SIZE).fill(0);
  const gridCounts = new Array<number>(GRID_SIZE * GRID_SIZE).fill(0);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = (y * width + x) * 4;
      const grayIndex = y * width + x;
      const blue = bitmap[pixelIndex];
      const green = bitmap[pixelIndex + 1];
      const red = bitmap[pixelIndex + 2];
      const grayscaleValue = Math.round(red * 0.299 + green * 0.587 + blue * 0.114);
      grayscale[grayIndex] = grayscaleValue;

      const gridIndex = gridPositionToIndex(x, y, width, height);
      gridEnergy[gridIndex] += grayscaleValue;
      gridCounts[gridIndex] += 1;
    }
  }

  for (let index = 0; index < gridEnergy.length; index += 1) {
    if (gridCounts[index] > 0) {
      gridEnergy[index] /= gridCounts[index];
    }
  }

  return {
    width,
    height,
    grayscale,
    gridEnergy,
    signatureBits: buildAverageHashBits(gridEnergy)
  };
}

export function computeVisualDelta(
  previous: FrameAnalysisSnapshot | null,
  current: FrameAnalysisSnapshot
): number {
  if (!previous) {
    return 0;
  }
  let totalDelta = 0;
  for (let index = 0; index < current.grayscale.length; index += 1) {
    totalDelta += Math.abs(current.grayscale[index] - previous.grayscale[index]);
  }
  return totalDelta / current.grayscale.length / 255;
}

export function computeHashDistance(
  previous: FrameAnalysisSnapshot | null,
  current: FrameAnalysisSnapshot
): number {
  if (!previous) {
    return 0;
  }
  let distance = 0;
  for (let index = 0; index < current.signatureBits.length; index += 1) {
    if (current.signatureBits[index] !== previous.signatureBits[index]) {
      distance += 1;
    }
  }
  return distance;
}

export function computeClusterScore(
  previous: FrameAnalysisSnapshot | null,
  current: FrameAnalysisSnapshot
): number {
  const diffGrid = buildDiffGrid(previous, current);
  const total = diffGrid.reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return 0;
  }
  const sorted = [...diffGrid].sort((left, right) => right - left);
  const topSum = sorted.slice(0, 3).reduce((sum, value) => sum + value, 0);
  return clamp01(topSum / total);
}

export function buildRoiProposal(
  previous: FrameAnalysisSnapshot | null,
  current: FrameAnalysisSnapshot,
  fullWidth: number,
  fullHeight: number
): ROIProposal {
  const diffGrid = buildDiffGrid(previous, current);
  const total = diffGrid.reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return { boxes: [], coverageRatio: 0, heatmapScore: 0 };
  }

  const rankedCells = diffGrid
    .map((value, index) => ({ index, value }))
    .filter((item) => item.value > 0)
    .sort((left, right) => right.value - left.value)
    .slice(0, MAX_ROI_BOXES);

  const boxes = mergeBoxes(
    rankedCells.map((item) => buildGridCellBox(item.index, fullWidth, fullHeight))
  );
  const coverageRatio = clamp01(
    boxes.reduce((sum, box) => sum + box.width * box.height, 0) / (fullWidth * fullHeight)
  );

  if (coverageRatio > MAX_COVERAGE_RATIO) {
    return {
      boxes: [],
      coverageRatio,
      heatmapScore: clamp01(total / diffGrid.length / 255)
    };
  }

  return {
    boxes,
    coverageRatio,
    heatmapScore: clamp01(total / diffGrid.length / 255)
  };
}

function buildDiffGrid(
  previous: FrameAnalysisSnapshot | null,
  current: FrameAnalysisSnapshot
): number[] {
  if (!previous) {
    return new Array<number>(GRID_SIZE * GRID_SIZE).fill(0);
  }
  return current.gridEnergy.map((value, index) => Math.abs(value - previous.gridEnergy[index]));
}

function buildAverageHashBits(gridEnergy: number[]): string {
  const average = gridEnergy.reduce((sum, value) => sum + value, 0) / gridEnergy.length;
  return gridEnergy.map((value) => (value >= average ? "1" : "0")).join("");
}

function gridPositionToIndex(
  x: number,
  y: number,
  width: number,
  height: number
): number {
  const gridX = Math.min(GRID_SIZE - 1, Math.floor((x / width) * GRID_SIZE));
  const gridY = Math.min(GRID_SIZE - 1, Math.floor((y / height) * GRID_SIZE));
  return gridY * GRID_SIZE + gridX;
}

function buildGridCellBox(index: number, fullWidth: number, fullHeight: number): ROIBox {
  const cellWidth = fullWidth / GRID_SIZE;
  const cellHeight = fullHeight / GRID_SIZE;
  const gridX = index % GRID_SIZE;
  const gridY = Math.floor(index / GRID_SIZE);
  const rawBox: ROIBox = {
    x: Math.floor(gridX * cellWidth),
    y: Math.floor(gridY * cellHeight),
    width: Math.ceil(cellWidth),
    height: Math.ceil(cellHeight)
  };
  return addPadding(rawBox, fullWidth, fullHeight);
}

function addPadding(box: ROIBox, fullWidth: number, fullHeight: number): ROIBox {
  const padX = Math.round(box.width * ROI_PADDING_RATIO);
  const padY = Math.round(box.height * ROI_PADDING_RATIO);
  const x = Math.max(0, box.x - padX);
  const y = Math.max(0, box.y - padY);
  const right = Math.min(fullWidth, box.x + box.width + padX);
  const bottom = Math.min(fullHeight, box.y + box.height + padY);
  return {
    x,
    y,
    width: right - x,
    height: bottom - y
  };
}

function mergeBoxes(boxes: ROIBox[]): ROIBox[] {
  const result: ROIBox[] = [];
  for (const box of boxes) {
    const existingIndex = result.findIndex((item) => boxesTouchOrOverlap(item, box));
    if (existingIndex === -1) {
      result.push(box);
      continue;
    }
    result[existingIndex] = mergeTwoBoxes(result[existingIndex], box);
  }
  return result.slice(0, MAX_ROI_BOXES);
}

function boxesTouchOrOverlap(left: ROIBox, right: ROIBox): boolean {
  const leftRight = left.x + left.width;
  const rightRight = right.x + right.width;
  const leftBottom = left.y + left.height;
  const rightBottom = right.y + right.height;
  return !(
    leftRight < right.x - 1 ||
    rightRight < left.x - 1 ||
    leftBottom < right.y - 1 ||
    rightBottom < left.y - 1
  );
}

function mergeTwoBoxes(left: ROIBox, right: ROIBox): ROIBox {
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const rightEdge = Math.max(left.x + left.width, right.x + right.width);
  const bottomEdge = Math.max(left.y + left.height, right.y + right.height);
  return {
    x,
    y,
    width: rightEdge - x,
    height: bottomEdge - y
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
