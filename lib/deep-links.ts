function encoded(value: string) {
  return encodeURIComponent(value.trim());
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function currentUuidDeepLink(queryName: string, hashPrefix: string) {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const fromQuery = url.searchParams.get(queryName)?.trim() ?? "";
  const escapedPrefix = hashPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const fromHash = url.hash.match(new RegExp(`^#${escapedPrefix}-([0-9a-f-]+)$`, "i"))?.[1] ?? "";
  const requestedId = fromQuery || fromHash;
  return uuidPattern.test(requestedId) ? requestedId : null;
}

export function currentPositiveIntegerDeepLink(queryName: string, hashPrefix: string) {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const fromQuery = url.searchParams.get(queryName)?.trim() ?? "";
  const escapedPrefix = hashPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const fromHash = url.hash.match(new RegExp(`^#${escapedPrefix}-(\\d+)$`))?.[1] ?? "";
  const parsed = Number(fromQuery || fromHash);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function taskDomId(taskId: string) {
  return `task-${taskId}`;
}

export function taskDeepLink(taskId: string) {
  const id = encoded(taskId);
  return `/tasks/${id}`;
}

export function taskDeliveryDeepLink(taskId: string) {
  const id = encoded(taskId);
  return `/tasks/${id}?action=deliver#delivery`;
}

export function taskReference(taskId: string) {
  const compact = taskId.replace(/[^a-z0-9]/gi, "").slice(0, 8).toUpperCase();
  return `MW-${compact || "TASK"}`;
}

export function crmContactDeepLink(contactId: string) {
  const id = encoded(contactId);
  return `/crm/${id}`;
}

export function crmContactReference(contactId: string) {
  const compact = contactId.replace(/[^a-z0-9]/gi, "").slice(0, 8).toUpperCase();
  return `CRM-${compact || "CONTACT"}`;
}

export function contentDeepLink(contentId: string) {
  const id = encoded(contentId);
  return `/content?content=${id}#content-${id}`;
}

export function contentRevisionDeepLink(contentId: string, revisionId: string) {
  const content = encoded(contentId);
  const revision = encoded(revisionId);
  return `/content?content=${content}&revision=${revision}#revision-${revision}`;
}

export function scriptResearchDeepLink(researchId: string) {
  const id = encoded(researchId);
  return `/scripts?tab=radar&research=${id}#research-${id}`;
}

export function publishingOccurrenceDeepLink(occurrenceId: string) {
  const id = encoded(occurrenceId);
  return `/publishing?occurrence=${id}#occurrence-${id}`;
}

export function launchDeepLink(launchId: string) {
  const id = encoded(launchId);
  return `/campaigns?launch=${id}#launch-${id}`;
}

export function launchDeliverableDeepLink(deliverableId: string) {
  const id = encoded(deliverableId);
  return `/campaigns?deliverable=${id}#deliverable-${id}`;
}
