import type { PDFPage } from 'pdf-lib'

/**
 * A page's geometry in PDF user space plus the rotation it is *displayed* with.
 * Editing/watermark code works in "visual" coordinates (what the user sees:
 * origin bottom-left, y up, after rotation) and converts to user space here.
 */
export interface PageGeom {
  x: number
  y: number
  w: number
  h: number
  rot: 0 | 90 | 180 | 270
}

export const normRot = (a: number) => ((((Math.round(a / 90) * 90) % 360) + 360) % 360) as PageGeom['rot']

export function pageGeom(page: PDFPage, extraRotation = 0): PageGeom {
  const b = page.getCropBox()
  return { x: b.x, y: b.y, w: b.width, h: b.height, rot: normRot(page.getRotation().angle + extraRotation) }
}

export function visualDims(g: PageGeom): { w: number; h: number } {
  return g.rot % 180 ? { w: g.h, h: g.w } : { w: g.w, h: g.h }
}

/** Visual point (origin bottom-left of the displayed page, y up) -> user-space point. */
export function toUser(g: PageGeom, vx: number, vyUp: number): { x: number; y: number } {
  switch (g.rot) {
    case 0:
      return { x: g.x + vx, y: g.y + vyUp }
    case 90:
      return { x: g.x + g.w - vyUp, y: g.y + vx }
    case 180:
      return { x: g.x + g.w - vx, y: g.y + g.h - vyUp }
    case 270:
      return { x: g.x + vyUp, y: g.y + g.h - vx }
  }
}
