-- Sample data for trying the site locally. Do NOT run this against the live database.
INSERT INTO shows (id, title, subtitle, description, notes, regular_price_cents, premium_price_cents, regular_seats, premium_seats, published, created_at)
VALUES (1, 'Annie', 'The beloved musical, performed by our local cast',
  'The sun''ll come out tomorrow! Join little orphan Annie, Daddy Warbucks and the whole gang for a heartwarming evening of music and fun for the entire family.',
  'Bring your email receipt for admission.
All sales are final. No refunds.
For specific seating, call (208) 451-5152.',
  1500, 2000, 100, 40, 1, 0);

INSERT INTO performances (show_id, date, start_time, end_time, status) VALUES
  (1, '2027-04-09', '18:00', '20:00', 'on_sale'),
  (1, '2027-04-10', '14:00', '16:00', 'on_sale'),
  (1, '2027-04-10', '18:00', '20:00', 'on_sale'),
  (1, '2027-04-16', '18:00', '20:00', 'paused');
