import { cn } from '../../lib/utils'
import { fmtRoi, roiTone, type RoiTone } from './roiMath'

const CLS: Record<RoiTone, string> = {
  red: 'bg-danger-soft text-danger',
  amber: 'bg-warning-soft text-warning',
  green: 'bg-success-soft text-success',
  none: 'text-muted-foreground',
}
const WORD: Record<RoiTone, string> = { red: 'below 1', amber: '1 to 2', green: '2 or more', none: 'no data' }

/** ROI as "3.2x", coloured by the one threshold constant (ROI_THRESHOLDS); the colour is also written in the tooltip. */
export function RoiBadge({ roi }: { roi: number | null }) {
  const t = roiTone(roi)
  return <span title={`ROI ${WORD[t]}`} className={cn('tnum inline-block rounded-full px-2 py-0.5 text-xs font-semibold', CLS[t])}>{fmtRoi(roi)}</span>
}
