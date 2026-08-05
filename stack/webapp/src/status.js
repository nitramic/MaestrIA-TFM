const DUE_SOON_WINDOW_DAYS = 30;

function computeStatus(nextDue) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(nextDue);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due - today) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 'overdue';
  if (diffDays <= DUE_SOON_WINDOW_DAYS) return 'due_soon';
  return 'ok';
}

function serialize(row) {
  return {
    code: row.code,
    siteId: row.site_id !== undefined ? row.site_id : null,
    location: row.location,
    type: row.type,
    weightKg: row.weight_kg !== null ? Number(row.weight_kg) : null,
    pressureBar: row.pressure_bar !== null ? Number(row.pressure_bar) : null,
    serialNumber: row.serial_number,
    lastInspected: row.last_inspected,
    nextDue: row.next_due,
    status: computeStatus(row.next_due),
  };
}

module.exports = { DUE_SOON_WINDOW_DAYS, computeStatus, serialize };
