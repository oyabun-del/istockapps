import type { CodeWaitDto, DeliveryAppDto, DeliveryDto, DeliveryGroupDto, DeliveryState } from '@istock/shared';
import type { CodeWait, DeliveryApp, DeliveryGroup, DeliverySnapshot } from '../providers/delivery/delivery-provider.js';

/**
 * Pure mapping of one fresh snapshot to what the buyer sees. Nothing from earlier snapshots is
 * merged in: a revoked flag, a replacement banner or a link disappears as soon as the API drops it.
 */

function isGroupExpired(group: DeliveryGroup, snapshot: DeliverySnapshot, now: Date): boolean {
  return snapshot.isExpired || group.expiresAt.getTime() <= now.getTime();
}

function appState(app: DeliveryApp, group: DeliveryGroup, snapshot: DeliverySnapshot, now: Date): DeliveryState {
  if (isGroupExpired(group, snapshot, now)) return 'expired';
  if (!group.isRevoked && app.links) return 'available';
  if (snapshot.replacingAppIds.has(app.id)) return 'replacing';
  return group.isRevoked ? 'revoked' : 'unavailable';
}

function groupState(apps: readonly DeliveryAppDto[]): DeliveryState {
  const states = new Set(apps.map((app) => app.state));
  const priority: readonly DeliveryState[] = ['available', 'replacing', 'revoked', 'expired', 'unavailable'];
  return priority.find((state) => states.has(state)) ?? 'unavailable';
}

function toGroupDto(group: DeliveryGroup, snapshot: DeliverySnapshot, now: Date): DeliveryGroupDto {
  const apps = group.apps.map((app) => {
    const state = appState(app, group, snapshot, now);
    return { id: app.id, name: app.name, state, links: state === 'available' ? app.links : null };
  });
  return {
    id: group.id,
    state: groupState(apps),
    expiresAt: group.expiresAt.toISOString(),
    message: group.isRevoked ? group.revokedMessage : null,
    codesLeft: Math.max(0, group.codesLimit - group.codesUsed),
    apps,
  };
}

/** Hides positions of an app that already works in another group, e.g. the old blocked one after a replacement. */
function withoutSupersededApps(groups: readonly DeliveryGroupDto[]): DeliveryGroupDto[] {
  const availableIds = new Set(
    groups.flatMap((group) => group.apps.filter((app) => app.state === 'available').map((app) => app.id)),
  );
  return groups
    .map((group) => {
      const apps = group.apps.filter((app) => app.state === 'available' || !availableIds.has(app.id));
      return { ...group, apps, state: groupState(apps) };
    })
    .filter((group) => group.apps.length > 0);
}

export function toDeliveryDto(snapshot: DeliverySnapshot, now: Date): DeliveryDto {
  const groups = withoutSupersededApps(snapshot.groups.map((group) => toGroupDto(group, snapshot, now)));
  return {
    expiresAt: snapshot.expiresAt.toISOString(),
    isSandbox: snapshot.isSandbox,
    groups,
    isReplacing: groups.some((group) => group.apps.some((app) => app.state === 'replacing')),
  };
}

/** A group can receive credentials and codes only while it is available. */
export function isGroupUsable(group: DeliveryGroup, snapshot: DeliverySnapshot, now: Date): boolean {
  return toGroupDto(group, snapshot, now).state === 'available';
}

export function toCodeWaitDto(wait: CodeWait, groupId: string): CodeWaitDto {
  const hasCode = wait.status === 'succeeded' && wait.code !== null && (wait.validForSeconds ?? 0) > 0;
  return {
    id: wait.id,
    groupId,
    status: wait.status,
    code: hasCode ? wait.code : null,
    // A relative TTL: the Mini App counts it from when the response arrived, so no clock is compared.
    codeTtlSeconds: hasCode ? wait.validForSeconds : null,
    deadlineAt: wait.deadlineAt?.toISOString() ?? null,
  };
}
