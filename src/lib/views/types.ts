export const VIEW_TYPES = ["table", "kanban", "calendar", "gallery", "timeline"] as const;
export type ViewType = (typeof VIEW_TYPES)[number];

export const MAX_VIEW_NAME_LENGTH = 100;
