module.exports = function paginate(rows, { page = 1, pageSize = 20, filter = null } = {}) {
  const selected = filter ? rows.filter(filter) : rows
  const currentPage = filter ? 1 : page
  const pageCount = Math.ceil(selected.length / pageSize)
  return {
    items: selected.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    page: currentPage,
    pageCount,
    hasPrevious: currentPage > 1 && pageCount > 0,
    hasNext: currentPage < pageCount
  }
}
