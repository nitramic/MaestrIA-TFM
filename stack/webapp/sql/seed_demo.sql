-- Demo data for the "demo" company database.
-- Login: admin@demo / Demo1234!
INSERT INTO users (email, password_hash, full_name, role)
VALUES ('admin@demo', '$2b$10$YMmPtiyekZfq02FJUZ/KqeyCYsqnk7rPH28GsgGT4pzdpoLZdTkbq', 'Admin Demo', 'admin')
ON CONFLICT (email) DO NOTHING;

-- Second demo login: inspector@demo / Demo1234! (non-admin, for testing role-gated Settings)
INSERT INTO users (email, password_hash, full_name, role)
VALUES ('inspector@demo', '$2b$10$YMmPtiyekZfq02FJUZ/KqeyCYsqnk7rPH28GsgGT4pzdpoLZdTkbq', 'Inspector Demo', 'inspector')
ON CONFLICT (email) DO NOTHING;

-- A locked-out demo account, to exercise the admin "unlock" action.
INSERT INTO users (email, password_hash, full_name, role, locked)
VALUES ('locked@demo', '$2b$10$YMmPtiyekZfq02FJUZ/KqeyCYsqnk7rPH28GsgGT4pzdpoLZdTkbq', 'Inspector Bloqueado', 'inspector', true)
ON CONFLICT (email) DO NOTHING;

INSERT INTO sites (name, lat, lng) VALUES
  ('Sede Central -- Edificio Principal', 40.416900, -3.703800),
  ('Almacen Norte', 40.483900, -3.674600),
  ('Delegacion Valencia', 39.469900, -0.376300),
  ('Oficina Barcelona', 41.387400, 2.168600),
  ('Planta Sevilla', 37.389100, -5.984500)
ON CONFLICT (name) DO NOTHING;

INSERT INTO extinguishers (code, site_id, location, type, weight_kg, pressure_bar, serial_number, last_inspected, next_due) VALUES
  ('EXT-001', (SELECT id FROM sites WHERE name = 'Sede Central -- Edificio Principal'), 'Floor 4 -- Meeting Rooms', 'Wet Chemical', 6, 13, 'SN-301629-WET', '2026-06-17', '2027-06-17'),
  ('EXT-002', (SELECT id FROM sites WHERE name = 'Almacen Norte'), 'Warehouse -- Loading Dock', 'CO2 Gas', 5, 56, 'SN-358607-CO2', '2026-04-30', '2027-04-30'),
  ('EXT-003', (SELECT id FROM sites WHERE name = 'Sede Central -- Edificio Principal'), 'Floor 3 -- Hallway', 'CO2 Gas', 4, 61, 'SN-430776-CO2', '2025-10-06', '2026-10-06'),
  ('EXT-004', (SELECT id FROM sites WHERE name = 'Almacen Norte'), 'Warehouse -- Bay 2', 'CO2 Gas', 6, 58, 'SN-774079-CO2', '2026-02-16', '2027-02-16'),
  ('EXT-005', (SELECT id FROM sites WHERE name = 'Sede Central -- Edificio Principal'), 'Floor 1 -- Cafeteria', 'Water', 9, 15, 'SN-712982-WAT', '2026-06-22', '2027-06-22'),
  ('EXT-006', (SELECT id FROM sites WHERE name = 'Sede Central -- Edificio Principal'), 'Floor 1 -- Lobby', 'ABC Dry Powder', 5, 16, 'SN-388389-ABC', '2025-06-26', '2026-06-26'),
  ('EXT-007', (SELECT id FROM sites WHERE name = 'Sede Central -- Edificio Principal'), 'Basement -- Electrical Room', 'Water', 8, 13, 'SN-182627-WAT', '2026-05-01', '2027-05-01'),
  ('EXT-008', (SELECT id FROM sites WHERE name = 'Sede Central -- Edificio Principal'), 'Floor 2 -- Hallway', 'Wet Chemical', 6, 14, 'SN-440035-WET', '2026-03-21', '2027-03-21'),
  ('EXT-009', (SELECT id FROM sites WHERE name = 'Sede Central -- Edificio Principal'), 'Basement -- Parking', 'ABC Dry Powder', 5, 14, 'SN-201414-ABC', '2026-02-27', '2027-02-27'),
  ('EXT-010', (SELECT id FROM sites WHERE name = 'Sede Central -- Edificio Principal'), 'Floor 3 -- Office North', 'Wet Chemical', 6, 10, 'SN-900581-WET', '2026-03-01', '2027-03-01'),
  ('EXT-011', (SELECT id FROM sites WHERE name = 'Sede Central -- Edificio Principal'), 'Rooftop -- Mechanical Room', 'Wet Chemical', 6, 11, 'SN-472528-WET', '2026-04-28', '2027-04-28'),
  ('EXT-012', (SELECT id FROM sites WHERE name = 'Sede Central -- Edificio Principal'), 'Floor 4 -- Office South', 'ABC Dry Powder', 6, 17, 'SN-403445-ABC', '2025-10-13', '2026-10-13'),
  ('EXT-013', (SELECT id FROM sites WHERE name = 'Sede Central -- Edificio Principal'), 'Floor 3 -- Break Room', 'ABC Dry Powder', 6, 16, 'SN-543143-ABC', '2026-01-28', '2027-01-28'),
  ('EXT-014', (SELECT id FROM sites WHERE name = 'Almacen Norte'), 'Warehouse -- Bay 1', 'Wet Chemical', 5, 10, 'SN-694731-WET', '2026-04-01', '2027-04-01'),
  ('EXT-015', (SELECT id FROM sites WHERE name = 'Sede Central -- Edificio Principal'), 'Basement -- Storage', 'Wet Chemical', 6, 15, 'SN-145561-WET', '2026-03-10', '2027-03-10'),
  ('EXT-016', (SELECT id FROM sites WHERE name = 'Sede Central -- Edificio Principal'), 'Floor 5 -- Executive Suite', 'CO2 Gas', 4, 58, 'SN-391476-CO2', '2025-10-18', '2026-10-18'),
  ('EXT-017', (SELECT id FROM sites WHERE name = 'Sede Central -- Edificio Principal'), 'Floor 3 -- Kitchen', 'Foam', 9, 13, 'SN-717889-FOA', '2026-06-14', '2027-06-14'),
  ('EXT-018', (SELECT id FROM sites WHERE name = 'Sede Central -- Edificio Principal'), 'Floor 2 -- IT Closet', 'Water', 10, 12, 'SN-329974-WAT', '2026-04-15', '2027-04-15'),
  ('EXT-019', (SELECT id FROM sites WHERE name = 'Sede Central -- Edificio Principal'), 'Floor 2 -- Office East', 'ABC Dry Powder', 5, 12, 'SN-343962-ABC', '2025-08-06', '2026-08-06'),
  ('EXT-020', (SELECT id FROM sites WHERE name = 'Sede Central -- Edificio Principal'), 'Floor 1 -- Reception', 'CO2 Gas', 5, 60, 'SN-207473-CO2', '2025-05-07', '2026-05-07'),
  ('EXT-021', (SELECT id FROM sites WHERE name = 'Sede Central -- Edificio Principal'), 'Floor 2 -- Server Room', 'Water', 8, 14, 'SN-542417-WAT', '2025-08-26', '2026-08-26'),
  ('EXT-022', (SELECT id FROM sites WHERE name = 'Sede Central -- Edificio Principal'), 'Floor 1 -- Hallway A', 'Wet Chemical', 5, 13, 'SN-765822-WET', '2025-12-24', '2026-12-24'),
  ('EXT-023', (SELECT id FROM sites WHERE name = 'Sede Central -- Edificio Principal'), 'Floor 1 -- Hallway B', 'Water', 9, 11, 'SN-584714-WAT', '2025-12-04', '2026-12-04'),
  ('EXT-024', (SELECT id FROM sites WHERE name = 'Sede Central -- Edificio Principal'), 'Floor 2 -- Office West', 'Water', 8, 14, 'SN-308496-WAT', '2025-08-21', '2026-08-21'),
  -- Extra sites so the Units map shows a mix of "needs intervention" and all-OK bubbles.
  ('EXT-025', (SELECT id FROM sites WHERE name = 'Delegacion Valencia'), 'Planta Baja -- Recepcion', 'ABC Dry Powder', 5, 15, 'SN-100025-ABC', '2026-05-10', '2027-05-10'),
  ('EXT-026', (SELECT id FROM sites WHERE name = 'Delegacion Valencia'), 'Planta 1 -- Oficinas', 'CO2 Gas', 4, 57, 'SN-100026-CO2', '2026-06-01', '2027-06-01'),
  ('EXT-027', (SELECT id FROM sites WHERE name = 'Oficina Barcelona'), 'Planta 3 -- Sala Servidores', 'Water', 8, 13, 'SN-100027-WAT', '2024-11-01', '2025-11-01'),
  ('EXT-028', (SELECT id FROM sites WHERE name = 'Oficina Barcelona'), 'Planta 1 -- Recepcion', 'ABC Dry Powder', 5, 16, 'SN-100028-ABC', '2026-01-15', '2027-01-15'),
  ('EXT-029', (SELECT id FROM sites WHERE name = 'Planta Sevilla'), 'Nave -- Zona Carga', 'Foam', 9, 12, 'SN-100029-FOA', '2025-08-01', '2026-08-20'),
  ('EXT-030', (SELECT id FROM sites WHERE name = 'Planta Sevilla'), 'Nave -- Oficina Tecnica', 'CO2 Gas', 4, 59, 'SN-100030-CO2', '2026-03-15', '2027-03-15')
ON CONFLICT (code) DO NOTHING;

-- Sample inspection history so the Reports log/stats aren't empty on first login.
INSERT INTO inspection_history (extinguisher_id, action, previous_status, new_status, performed_by, performed_at)
SELECT e.id, h.action, h.previous_status, h.new_status,
       (SELECT id FROM users WHERE email = 'admin@demo'), h.performed_at
FROM (VALUES
  ('EXT-002', 'status_change', 'overdue', 'ok', now() - interval '2 days'),
  ('EXT-014', 'inspected', 'ok', 'ok', now() - interval '5 days'),
  ('EXT-021', 'status_change', 'due_soon', 'ok', now() - interval '9 days'),
  ('EXT-006', 'inspected', 'ok', 'ok', now() - interval '12 days'),
  ('EXT-028', 'status_change', 'overdue', 'ok', now() - interval '15 days'),
  ('EXT-016', 'inspected', 'ok', 'ok', now() - interval '18 days'),
  ('EXT-019', 'status_change', 'overdue', 'ok', now() - interval '21 days'),
  ('EXT-025', 'inspected', 'ok', 'ok', now() - interval '24 days'),
  ('EXT-030', 'status_change', 'due_soon', 'ok', now() - interval '27 days'),
  ('EXT-020', 'inspected', 'ok', 'ok', now() - interval '30 days')
) AS h(code, action, previous_status, new_status, performed_at)
JOIN extinguishers e ON e.code = h.code
WHERE NOT EXISTS (SELECT 1 FROM inspection_history);
