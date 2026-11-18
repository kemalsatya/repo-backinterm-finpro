CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  email       text NOT NULL UNIQUE,
  role        text NOT NULL CHECK (role IN ('organizer','buyer')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id  uuid NOT NULL REFERENCES users(id),
  title         text NOT NULL,
  description   text,
  venue         text NOT NULL,
  starts_at     timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ticket_types (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id  uuid NOT NULL REFERENCES events(id),
  name      text NOT NULL CHECK (name IN ('REGULER','VIP')),
  price     integer NOT NULL CHECK (price >= 0),
  quota     integer NOT NULL CHECK (quota > 0),
  reserved  integer NOT NULL DEFAULT 0,   -- ditahan (pending) + terjual (paid)
  UNIQUE (event_id, name),
  UNIQUE (id, event_id),
  CHECK (reserved >= 0 AND reserved <= quota)
);

CREATE TABLE orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id),
  event_id        uuid NOT NULL,
  ticket_type_id  uuid NOT NULL,
  quantity        integer NOT NULL CHECK (quantity BETWEEN 1 AND 4),
  unit_price      integer NOT NULL,
  total_amount    integer NOT NULL,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','paid','cancelled','expired')),
  expires_at      timestamptz NOT NULL,
  paid_at         timestamptz,
  cancelled_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (ticket_type_id, event_id) REFERENCES ticket_types(id, event_id)
);
CREATE INDEX orders_sweeper_idx ON orders (expires_at) WHERE status = 'pending';
CREATE INDEX orders_user_idx    ON orders (user_id, created_at DESC);

-- penjaga batas 4 tiket per pembeli per event
CREATE TABLE buyer_event_quota (
  event_id      uuid NOT NULL REFERENCES events(id),
  user_id       uuid NOT NULL REFERENCES users(id),
  ticket_count  integer NOT NULL DEFAULT 0 CHECK (ticket_count BETWEEN 0 AND 4),
  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE tickets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   uuid NOT NULL REFERENCES orders(id),
  seq        smallint NOT NULL,           -- 1..quantity
  code       text NOT NULL UNIQUE,
  issued_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, seq)
);

-- jejak webhook; juga kunci idempotency
CREATE TABLE payment_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_event_id  text NOT NULL UNIQUE,
  order_id           uuid NOT NULL REFERENCES orders(id),
  status             text NOT NULL CHECK (status IN ('success','failed')),
  amount             integer NOT NULL,
  outcome            text NOT NULL,       -- applied | late_rejected | ignored
  payload            jsonb NOT NULL,
  received_at        timestamptz NOT NULL DEFAULT now()
);