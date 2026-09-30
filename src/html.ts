export const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
