export function creatorCalendarRoutes(service) {
  return { "GET /api/me/artist-calendar": ctx => service.list(ctx) };
}
