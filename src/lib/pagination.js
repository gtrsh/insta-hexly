export function parsePage(value) {
  const page = Number.parseInt(value, 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

export function buildPagination({ page, pageSize, total, baseUrl, window = 2 }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, totalPages);
  const href = (n) => (n === 1 ? baseUrl : `${baseUrl}?page=${n}`);

  const items = [];
  let last = 0;
  for (let n = 1; n <= totalPages; n += 1) {
    const inWindow = Math.abs(n - current) <= window;
    if (n === 1 || n === totalPages || inWindow) {
      if (n - last > 1) items.push({ ellipsis: true });
      items.push({ number: n, href: href(n), active: n === current });
      last = n;
    }
  }

  return {
    page: current,
    totalPages,
    hasPages: totalPages > 1,
    prev: current > 1 ? href(current - 1) : null,
    next: current < totalPages ? href(current + 1) : null,
    items,
  };
}
