-- Demo data for the "demo" company database.
-- Password hash sustituido en tiempo de deploy (deploy-demo.sh) a partir de
-- DEMO_ADMIN_PASSWORD_HASH en secrets.env (ver generate-secrets.sh).
INSERT INTO users (email, password_hash, full_name, role)
VALUES ('admin@demo', '__DEMO_PASSWORD_HASH__', 'Admin Demo', 'admin')
ON CONFLICT (email) DO NOTHING;

-- Second demo login: inspector@demo, same password as admin@demo (non-admin, for testing role-gated Settings)
INSERT INTO users (email, password_hash, full_name, role)
VALUES ('inspector@demo', '__DEMO_PASSWORD_HASH__', 'Inspector Demo', 'inspector')
ON CONFLICT (email) DO NOTHING;

-- A locked-out demo account, to exercise the admin "unlock" action.
INSERT INTO users (email, password_hash, full_name, role, locked)
VALUES ('locked@demo', '__DEMO_PASSWORD_HASH__', 'Inspector Bloqueado', 'inspector', true)
ON CONFLICT (email) DO NOTHING;

-- Sites use real neighborhoods/towns so the Units map lands on recognizable places.
-- Heavier coverage around Madrid, Barcelona and Valencia (and their metro areas),
-- plus a foothold in Italy (Roma, Milano, Torino) and one more Spanish city (Sevilla).
INSERT INTO sites (name, lat, lng) VALUES
  -- Madrid & metro area
  ('Madrid - Salamanca (Sede Central)', 40.430600, -3.678400),
  ('Madrid - Alcobendas (Almacen)', 40.537900, -3.642300),
  ('Madrid - Getafe (Delegacion)', 40.305700, -3.732700),
  ('Madrid - Alcala de Henares (Oficina)', 40.481800, -3.363500),
  -- Barcelona & metro area
  ('Barcelona - Eixample (Oficina)', 41.388800, 2.159000),
  ('Barcelona - L''Hospitalet de Llobregat (Planta)', 41.359800, 2.099800),
  ('Barcelona - Badalona (Delegacion)', 41.450000, 2.247400),
  -- Valencia & metro area
  ('Valencia - Ciutat Vella (Delegacion)', 39.474600, -0.376300),
  ('Valencia - Paterna (Planta)', 39.503300, -0.440900),
  -- Other Spanish city
  ('Sevilla - Triana (Planta)', 37.382800, -6.002700),
  -- Italy
  ('Roma - Centro Storico (Ufficio)', 41.893300, 12.482900),
  ('Milano - Navigli (Ufficio)', 45.450800, 9.173900),
  ('Torino - Centro (Ufficio)', 45.070300, 7.686900)
ON CONFLICT (name) DO NOTHING;

INSERT INTO extinguishers (code, site_id, location, type, weight_kg, pressure_bar, serial_number, last_inspected, next_due) VALUES
  ('EXT-001', (SELECT id FROM sites WHERE name = 'Madrid - Salamanca (Sede Central)'), 'Planta 4 -- Salas de Reuniones', 'Wet Chemical', 6, 13, 'SN-301629-WET', '2026-06-17', '2027-06-17'),
  ('EXT-002', (SELECT id FROM sites WHERE name = 'Madrid - Alcobendas (Almacen)'), 'Almacen -- Muelle de Carga', 'CO2 Gas', 5, 56, 'SN-358607-CO2', '2026-04-30', '2027-04-30'),
  ('EXT-003', (SELECT id FROM sites WHERE name = 'Madrid - Salamanca (Sede Central)'), 'Planta 3 -- Pasillo', 'CO2 Gas', 4, 61, 'SN-430776-CO2', '2025-10-06', '2026-10-06'),
  ('EXT-004', (SELECT id FROM sites WHERE name = 'Madrid - Alcobendas (Almacen)'), 'Almacen -- Nave 2', 'CO2 Gas', 6, 58, 'SN-774079-CO2', '2026-02-16', '2027-02-16'),
  ('EXT-005', (SELECT id FROM sites WHERE name = 'Madrid - Salamanca (Sede Central)'), 'Planta 1 -- Cafeteria', 'Water', 9, 15, 'SN-712982-WAT', '2026-06-22', '2027-06-22'),
  ('EXT-006', (SELECT id FROM sites WHERE name = 'Madrid - Salamanca (Sede Central)'), 'Planta 1 -- Recepcion', 'ABC Dry Powder', 5, 16, 'SN-388389-ABC', '2025-06-26', '2026-06-26'),
  ('EXT-007', (SELECT id FROM sites WHERE name = 'Madrid - Salamanca (Sede Central)'), 'Sotano -- Sala Electrica', 'Water', 8, 13, 'SN-182627-WAT', '2026-05-01', '2027-05-01'),
  ('EXT-008', (SELECT id FROM sites WHERE name = 'Madrid - Salamanca (Sede Central)'), 'Planta 2 -- Pasillo', 'Wet Chemical', 6, 14, 'SN-440035-WET', '2026-03-21', '2027-03-21'),
  ('EXT-009', (SELECT id FROM sites WHERE name = 'Madrid - Salamanca (Sede Central)'), 'Sotano -- Aparcamiento', 'ABC Dry Powder', 5, 14, 'SN-201414-ABC', '2026-02-27', '2027-02-27'),
  ('EXT-010', (SELECT id FROM sites WHERE name = 'Madrid - Salamanca (Sede Central)'), 'Planta 3 -- Oficina Norte', 'Wet Chemical', 6, 10, 'SN-900581-WET', '2026-03-01', '2027-03-01'),
  ('EXT-011', (SELECT id FROM sites WHERE name = 'Madrid - Salamanca (Sede Central)'), 'Azotea -- Sala de Maquinas', 'Wet Chemical', 6, 11, 'SN-472528-WET', '2026-04-28', '2027-04-28'),
  ('EXT-012', (SELECT id FROM sites WHERE name = 'Madrid - Salamanca (Sede Central)'), 'Planta 4 -- Oficina Sur', 'ABC Dry Powder', 6, 17, 'SN-403445-ABC', '2025-10-13', '2026-10-13'),
  ('EXT-013', (SELECT id FROM sites WHERE name = 'Madrid - Salamanca (Sede Central)'), 'Planta 3 -- Sala de Descanso', 'ABC Dry Powder', 6, 16, 'SN-543143-ABC', '2026-01-28', '2027-01-28'),
  ('EXT-014', (SELECT id FROM sites WHERE name = 'Madrid - Alcobendas (Almacen)'), 'Almacen -- Nave 1', 'Wet Chemical', 5, 10, 'SN-694731-WET', '2026-04-01', '2027-04-01'),
  ('EXT-015', (SELECT id FROM sites WHERE name = 'Madrid - Salamanca (Sede Central)'), 'Sotano -- Almacen', 'Wet Chemical', 6, 15, 'SN-145561-WET', '2026-03-10', '2027-03-10'),
  ('EXT-016', (SELECT id FROM sites WHERE name = 'Madrid - Salamanca (Sede Central)'), 'Planta 5 -- Direccion', 'CO2 Gas', 4, 58, 'SN-391476-CO2', '2025-10-18', '2026-10-18'),
  ('EXT-017', (SELECT id FROM sites WHERE name = 'Madrid - Salamanca (Sede Central)'), 'Planta 3 -- Cocina', 'Foam', 9, 13, 'SN-717889-FOA', '2026-06-14', '2027-06-14'),
  ('EXT-018', (SELECT id FROM sites WHERE name = 'Madrid - Salamanca (Sede Central)'), 'Planta 2 -- Armario de TI', 'Water', 10, 12, 'SN-329974-WAT', '2026-04-15', '2027-04-15'),
  ('EXT-019', (SELECT id FROM sites WHERE name = 'Madrid - Salamanca (Sede Central)'), 'Planta 2 -- Oficina Este', 'ABC Dry Powder', 5, 12, 'SN-343962-ABC', '2025-08-06', '2026-08-06'),
  ('EXT-020', (SELECT id FROM sites WHERE name = 'Madrid - Salamanca (Sede Central)'), 'Planta Baja -- Recepcion', 'CO2 Gas', 5, 60, 'SN-207473-CO2', '2025-05-07', '2026-05-07'),
  ('EXT-021', (SELECT id FROM sites WHERE name = 'Madrid - Salamanca (Sede Central)'), 'Planta 2 -- Sala Tecnica', 'Water', 8, 14, 'SN-542417-WAT', '2025-08-26', '2026-08-26'),
  ('EXT-022', (SELECT id FROM sites WHERE name = 'Madrid - Salamanca (Sede Central)'), 'Planta 1 -- Pasillo A', 'Wet Chemical', 5, 13, 'SN-765822-WET', '2025-12-24', '2026-12-24'),
  ('EXT-023', (SELECT id FROM sites WHERE name = 'Madrid - Salamanca (Sede Central)'), 'Planta 1 -- Pasillo B', 'Water', 9, 11, 'SN-584714-WAT', '2025-12-04', '2026-12-04'),
  ('EXT-024', (SELECT id FROM sites WHERE name = 'Madrid - Salamanca (Sede Central)'), 'Planta 2 -- Oficina Oeste', 'Water', 8, 14, 'SN-308496-WAT', '2025-08-21', '2026-08-21'),
  -- Extra sites so the Units map shows a mix of "needs intervention" and all-OK bubbles.
  ('EXT-025', (SELECT id FROM sites WHERE name = 'Valencia - Ciutat Vella (Delegacion)'), 'Planta Baja -- Recepcion', 'ABC Dry Powder', 5, 15, 'SN-100025-ABC', '2026-05-10', '2027-05-10'),
  ('EXT-026', (SELECT id FROM sites WHERE name = 'Valencia - Ciutat Vella (Delegacion)'), 'Planta 1 -- Oficinas', 'CO2 Gas', 4, 57, 'SN-100026-CO2', '2026-06-01', '2027-06-01'),
  ('EXT-027', (SELECT id FROM sites WHERE name = 'Barcelona - Eixample (Oficina)'), 'Planta 3 -- Sala Servidores', 'Water', 8, 13, 'SN-100027-WAT', '2024-11-01', '2025-11-01'),
  ('EXT-028', (SELECT id FROM sites WHERE name = 'Barcelona - Eixample (Oficina)'), 'Planta 1 -- Recepcion', 'ABC Dry Powder', 5, 16, 'SN-100028-ABC', '2026-01-15', '2027-01-15'),
  ('EXT-029', (SELECT id FROM sites WHERE name = 'Sevilla - Triana (Planta)'), 'Nave -- Zona Carga', 'Foam', 9, 12, 'SN-100029-FOA', '2025-08-01', '2026-08-20'),
  ('EXT-030', (SELECT id FROM sites WHERE name = 'Sevilla - Triana (Planta)'), 'Nave -- Oficina Tecnica', 'CO2 Gas', 4, 59, 'SN-100030-CO2', '2026-03-15', '2027-03-15'),
  -- Madrid metro area: Getafe (all OK) and Alcala de Henares (one overdue).
  ('EXT-031', (SELECT id FROM sites WHERE name = 'Madrid - Getafe (Delegacion)'), 'Planta Baja -- Recepcion', 'ABC Dry Powder', 5, 15, 'SN-100031-ABC', '2026-05-20', '2027-05-20'),
  ('EXT-032', (SELECT id FROM sites WHERE name = 'Madrid - Getafe (Delegacion)'), 'Planta 1 -- Oficinas', 'Wet Chemical', 6, 12, 'SN-100032-WET', '2026-06-05', '2027-06-05'),
  ('EXT-033', (SELECT id FROM sites WHERE name = 'Madrid - Getafe (Delegacion)'), 'Almacen -- Zona Carga', 'CO2 Gas', 5, 57, 'SN-100033-CO2', '2026-07-10', '2027-07-10'),
  ('EXT-034', (SELECT id FROM sites WHERE name = 'Madrid - Alcala de Henares (Oficina)'), 'Planta Baja -- Recepcion', 'Water', 9, 14, 'SN-100034-WAT', '2025-05-15', '2026-05-15'),
  ('EXT-035', (SELECT id FROM sites WHERE name = 'Madrid - Alcala de Henares (Oficina)'), 'Planta 1 -- Sala de Juntas', 'ABC Dry Powder', 5, 16, 'SN-100035-ABC', '2026-04-10', '2027-04-10'),
  ('EXT-036', (SELECT id FROM sites WHERE name = 'Madrid - Alcala de Henares (Oficina)'), 'Planta 2 -- Archivo', 'CO2 Gas', 4, 58, 'SN-100036-CO2', '2026-05-25', '2027-05-25'),
  -- Barcelona metro area: L'Hospitalet (all OK) and Badalona (one due soon).
  ('EXT-037', (SELECT id FROM sites WHERE name = 'Barcelona - L''Hospitalet de Llobregat (Planta)'), 'Nave -- Produccion', 'Foam', 9, 12, 'SN-100037-FOA', '2026-06-18', '2027-06-18'),
  ('EXT-038', (SELECT id FROM sites WHERE name = 'Barcelona - L''Hospitalet de Llobregat (Planta)'), 'Nave -- Almacen', 'ABC Dry Powder', 6, 15, 'SN-100038-ABC', '2026-07-01', '2027-07-01'),
  ('EXT-039', (SELECT id FROM sites WHERE name = 'Barcelona - L''Hospitalet de Llobregat (Planta)'), 'Oficina Tecnica', 'Wet Chemical', 5, 11, 'SN-100039-WET', '2026-06-28', '2027-06-28'),
  ('EXT-040', (SELECT id FROM sites WHERE name = 'Barcelona - Badalona (Delegacion)'), 'Planta Baja -- Recepcion', 'CO2 Gas', 5, 59, 'SN-100040-CO2', '2026-08-25', '2027-08-25'),
  ('EXT-041', (SELECT id FROM sites WHERE name = 'Barcelona - Badalona (Delegacion)'), 'Planta 1 -- Oficinas', 'ABC Dry Powder', 5, 14, 'SN-100041-ABC', '2026-08-30', '2027-08-30'),
  ('EXT-042', (SELECT id FROM sites WHERE name = 'Barcelona - Badalona (Delegacion)'), 'Planta 2 -- Terraza', 'Water', 8, 13, 'SN-100042-WAT', '2026-09-01', '2027-09-01'),
  -- Valencia metro area: Paterna (all OK).
  ('EXT-043', (SELECT id FROM sites WHERE name = 'Valencia - Paterna (Planta)'), 'Nave -- Linea de Produccion', 'CO2 Gas', 5, 56, 'SN-100043-CO2', '2026-06-12', '2027-06-12'),
  ('EXT-044', (SELECT id FROM sites WHERE name = 'Valencia - Paterna (Planta)'), 'Nave -- Zona Carga', 'Foam', 9, 12, 'SN-100044-FOA', '2026-07-15', '2027-07-15'),
  ('EXT-045', (SELECT id FROM sites WHERE name = 'Valencia - Paterna (Planta)'), 'Oficina Administrativa', 'Wet Chemical', 6, 13, 'SN-100045-WET', '2026-06-22', '2027-06-22'),
  -- Italy: Roma (one overdue), Milano (all OK), Torino (one due soon).
  ('EXT-046', (SELECT id FROM sites WHERE name = 'Roma - Centro Storico (Ufficio)'), 'Piano Terra -- Reception', 'ABC Dry Powder', 5, 15, 'SN-100046-ABC', '2025-04-05', '2026-04-05'),
  ('EXT-047', (SELECT id FROM sites WHERE name = 'Roma - Centro Storico (Ufficio)'), 'Piano 1 -- Uffici', 'CO2 Gas', 4, 58, 'SN-100047-CO2', '2026-05-18', '2027-05-18'),
  ('EXT-048', (SELECT id FROM sites WHERE name = 'Roma - Centro Storico (Ufficio)'), 'Piano 2 -- Sala Riunioni', 'Water', 8, 14, 'SN-100048-WAT', '2026-06-30', '2027-06-30'),
  ('EXT-049', (SELECT id FROM sites WHERE name = 'Milano - Navigli (Ufficio)'), 'Piano Terra -- Reception', 'Wet Chemical', 6, 12, 'SN-100049-WET', '2026-07-08', '2027-07-08'),
  ('EXT-050', (SELECT id FROM sites WHERE name = 'Milano - Navigli (Ufficio)'), 'Piano 1 -- Open Space', 'ABC Dry Powder', 5, 16, 'SN-100050-ABC', '2026-07-22', '2027-07-22'),
  ('EXT-051', (SELECT id FROM sites WHERE name = 'Milano - Navigli (Ufficio)'), 'Piano 2 -- Sala Server', 'CO2 Gas', 4, 60, 'SN-100051-CO2', '2026-08-05', '2027-08-05'),
  ('EXT-052', (SELECT id FROM sites WHERE name = 'Torino - Centro (Ufficio)'), 'Piano Terra -- Reception', 'Foam', 9, 13, 'SN-100052-FOA', '2026-08-20', '2027-08-20'),
  ('EXT-053', (SELECT id FROM sites WHERE name = 'Torino - Centro (Ufficio)'), 'Piano 1 -- Uffici', 'Water', 9, 11, 'SN-100053-WAT', '2026-06-05', '2027-06-05'),
  ('EXT-054', (SELECT id FROM sites WHERE name = 'Torino - Centro (Ufficio)'), 'Piano 2 -- Magazzino', 'ABC Dry Powder', 5, 15, 'SN-100054-ABC', '2026-06-15', '2027-06-15')
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
  ('EXT-020', 'inspected', 'ok', 'ok', now() - interval '30 days'),
  ('EXT-046', 'status_change', 'overdue', 'ok', now() - interval '33 days'),
  ('EXT-040', 'inspected', 'ok', 'ok', now() - interval '36 days')
) AS h(code, action, previous_status, new_status, performed_at)
JOIN extinguishers e ON e.code = h.code
WHERE NOT EXISTS (SELECT 1 FROM inspection_history);
