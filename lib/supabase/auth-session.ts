export function workspaceIdentityChanged(
  previousUserId: string | null | undefined,
  nextUserId: string | null,
) {
  return previousUserId === undefined || previousUserId !== nextUserId;
}
