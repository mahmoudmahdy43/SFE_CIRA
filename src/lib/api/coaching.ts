import { rpcAll } from './reports'
import {
  monthsWithData, normalizeEffect, toEffectRow, toRepMonth, toRepSummary, toRepVisit, toSkillRow, toTrendRow,
  type EffectRow, type EvalGroup, type RepMonth, type RepSummary, type RepVisit, type SkillRow, type TrendRow,
} from '../../features/reports/coachingMath'

/** Month-start dates in, one row per month with coaching out (coaching_company_trend). */
export async function fetchCoachingTrend(from: string, to: string): Promise<TrendRow[]> {
  return monthsWithData((await rpcAll('coaching_company_trend', { p_from: from, p_to: to }, ['month'])).map(toTrendRow))
}

export async function fetchCoachingSkills(from: string, to: string, group: EvalGroup): Promise<SkillRow[]> {
  return (await rpcAll('coaching_skill_matrix', { p_from: from, p_to: to, p_group: group }, ['scope_type', 'scope_key', 'sort'])).map(toSkillRow)
}

export async function fetchCoachingReps(from: string, to: string, group: EvalGroup, gap: number): Promise<RepSummary[]> {
  return (await rpcAll('coaching_rep_summary', { p_from: from, p_to: to, p_group: group, p_gap: gap }, ['rep_key'])).map(toRepSummary)
}

export async function fetchCoachingRepMonths(from: string, to: string, group: EvalGroup): Promise<RepMonth[]> {
  return (await rpcAll('coaching_rep_months', { p_from: from, p_to: to, p_group: group }, ['rep_key', 'month'])).map(toRepMonth)
}

export async function fetchCoachingRepVisits(repKey: string, from: string, to: string, group: EvalGroup): Promise<RepVisit[]> {
  return (await rpcAll('coaching_rep_visits', { p_rep_key: repKey, p_from: from, p_to: to, p_group: group }, ['seq'])).map(toRepVisit)
}

export async function fetchCoachingEffect(from: string, to: string, group: EvalGroup): Promise<EffectRow[]> {
  return normalizeEffect((await rpcAll('coaching_effect', { p_from: from, p_to: to, p_group: group }, ['band'])).map(toEffectRow))
}
