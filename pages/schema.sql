-- Week 10 game (working title Same Cloth): Supabase schema. Project ziszzyvlevgsjiazgogr (same project as Better Off, the ranch game, Chasing Powder, The Parent Trap).
-- Paste this whole file into the Supabase SQL editor and press Run. Safe to run twice. NOT RUN: written 2026-10-21 as a local file only.
-- Every table is prefixed ww_ so nothing collides with weed_*, powder_*, pt_* or the ranch game's tables.
-- Every NOT NULL column has a default, so the pages can write one column at a time.
-- RLS is on, with open anon policies, like the other classroom games: a join code is the only gate.
-- "round" in ww_games, ww_decisions, ww_snapshots and ww_log means the SEASON (1..4). The shell (supa.js, store.js) still calls it round.
-- Shell tables (kept from the Parent Trap, same columns): ww_games, ww_teams (+brand_id), ww_seats, ww_decisions (new plan column), ww_snapshots.
-- Game tables (new): ww_brands, ww_seasons, ww_designs, ww_bids, ww_deals. ww_log is the Parent Trap's event table renamed, with market, why and
-- payload columns for the debrief. The admin browser (which runs the engine) writes ww_brands, ww_seasons, ww_designs, ww_bids, ww_deals and ww_log.
-- Teams write only ww_decisions (their saved plan). A team-to-team carry offer sits in the plan's carry field; the host turns it into a ww_deals row.

create table if not exists ww_games (
  id          text primary key,                       -- WW-7K2M, also the ?g= value in every page URL
  seed        int  not null default 0,                -- the engine is deterministic: seed + plans rebuild the whole game
  team_count  int  not null default 8,
  bot_count   int  not null default 0,                -- bots exist only for the bede balance run; standings never show a bot row
  house_count int  not null default 0,                -- house (scripted) teams the host added, 0 to 4 (GAME_SPEC.md section 8)
  phase       text not null default 'lobby',          -- lobby | decide | resolving | reveal | results | final
  round       int  not null default 0,                -- the season: 0 in the lobby, then 1..4
  clock       jsonb,                                  -- {endsAt, paused, remaining, total}; the clock lives here, so a reload never resets it
  reveal      jsonb,                                  -- {season, market, idx, ...} the projector reveal queue, one market at a time
  rev         int  not null default 0,                -- bumped whenever the admin publishes snapshots; pages refetch on change
  status      text not null default 'active',
  admin_key   text not null default '',               -- the ?k= value for the admin and projector shortcuts
  settings    jsonb not null default '{}'::jsonb,     -- {autoResolve, autoAdvance, revealSecondsPerMarket, requireWhy}
  created_at  timestamptz not null default now()
);

create table if not exists ww_teams (
  game_id    text not null references ww_games(id) on delete cascade,
  team_id    text not null,                           -- T1..T12
  name       text not null default '',                -- the brand name (config/brands.js) unless renamed
  brand_id   text not null default '',                -- config/brands.js id
  join_code  text not null default '',                -- 4 characters, no 0/O/1/I
  renamed    boolean not null default false,
  house      boolean not null default false,          -- HOUSE flag: scripted team, out of the prize ranking, counted in every market split
  personality text not null default '',               -- steady | local | bold for a house team, else ''
  created_at timestamptz not null default now(),
  primary key (game_id, team_id)
);
create index if not exists ww_teams_code on ww_teams (join_code);

create table if not exists ww_seats (
  id            text primary key,
  game_id       text not null references ww_games(id) on delete cascade,
  team_id       text not null default '',
  name          text not null default '',
  slot          int  not null default 0,
  role          text not null default '',             -- unused (roles are off); kept so the shell's seat code runs unchanged
  role_override text,
  secret        text not null default '',             -- stale-cookie check; a takeover writes a new one
  removed       boolean not null default false,
  connected_at  timestamptz not null default now(),
  last_seen     timestamptz not null default now()
);
create index if not exists ww_seats_game on ww_seats (game_id);

-- The saved plan for one team and season. A team that never locks keeps its last saved plan (the card says "Your last plan stood").
create table if not exists ww_decisions (
  game_id      text not null references ww_games(id) on delete cascade,
  team_id      text not null,
  round        int  not null,                                            -- season
  plan         jsonb not null default '{"designs":[],"markets":{},"research":[],"copy":[],"carry":[]}'::jsonb,
                                                                         -- designs: [{id, cut, palette, logo, fabric}]
                                                                         -- markets: {berlin: {mode, design, price, run, bid}}
                                                                         -- research: [market]   copy: [{from_team, design, market}]
                                                                         -- carry: [{market, design, holder_team}] offers to a partner holder
  why          text not null default '',                                 -- optional one sentence for the debrief
  locked       boolean not null default false,
  locked_by    text,
  locked_at    timestamptz,
  lock_left    int,                                                      -- seconds left on the clock when the team locked
  stood        boolean not null default false,                           -- true when the host used the last saved plan because the team never locked
  notes        jsonb not null default '[]'::jsonb,
  engine_error text,
  updated_at   timestamptz not null default now(),
  primary key (game_id, team_id, round)
);

-- One row per team: the brand and its DNA as resolved from config/brands.js at game start (so a later config edit cannot change a played game).
create table if not exists ww_brands (
  game_id     text not null references ww_games(id) on delete cascade,
  team_id     text not null,
  brand_id    text not null default '',
  name        text not null default '',
  free_tiles  jsonb not null default '[]'::jsonb,       -- [{row, tile}, {row, tile}]
  costly_tile jsonb,                                    -- {row, tile}
  start_cash  numeric not null default 0,               -- $M
  house       boolean not null default false,
  primary key (game_id, team_id)
);

-- One row per team per season per market: the money and fit story of that market for the debrief.
create table if not exists ww_seasons (
  game_id        text not null references ww_games(id) on delete cascade,
  season         int  not null,
  team_id        text not null,
  market         text not null,                         -- berlin | tokyo | saopaulo | nairobi
  mode           text not null default '',              -- ship | partner | own | carried | none
  design_id      text not null default '',
  price_tier     text not null default '',              -- value | standard | premium
  run_units      numeric not null default 0,            -- thousands of garments made
  fit            numeric not null default 0,            -- 0..1 weighted match against the market's true taste
  tiles_known    int  not null default 0,               -- how many of the four taste tiles this team could see
  buyers         numeric not null default 0,            -- thousands of buyers won
  share          numeric not null default 0,
  revenue        numeric not null default 0,            -- $M
  unit_cost      numeric not null default 0,            -- $ per garment, including the foreignness tax
  tax_paid       numeric not null default 0,            -- $M foreignness tax
  duty_paid      numeric not null default 0,            -- $M, Sao Paulo shipped goods
  partner_fee    numeric not null default 0,            -- $M paid to a partner holder (revenue share, or the carry fee)
  setup_paid     numeric not null default 0,            -- $M own-shop set-up
  profit         numeric not null default 0,            -- $M for this market this season (design fees sit in ww_designs)
  crowd          int  not null default 0,               -- number of teams selling in this market this season
  tax_rate       numeric not null default 0,            -- foreignness tax rate that applied (share of unit cost, after the partner halving)
  seat_paid      numeric not null default 0,            -- $M the partner-seat winner paid for the seat (its own bid)
  partner_income numeric not null default 0,            -- $M the seat holder received (carry fees plus its revenue share)
  research_paid  numeric not null default 0,            -- $M spent on research in this market (zero in Nairobi by rule)
  suit_paid      numeric not null default 0,            -- $M fine paid for a copy sued in this market
  suit_received  numeric not null default 0,            -- $M fine received as the original owner
  house          boolean not null default false,
  payload        jsonb not null default '{}'::jsonb,
  primary key (game_id, season, team_id, market)
);

create table if not exists ww_designs (
  game_id     text not null references ww_games(id) on delete cascade,
  season      int  not null,
  team_id     text not null,
  design_id   text not null,                            -- D1..D4 within the team
  cut         text not null default '',
  palette     text not null default '',
  logo        text not null default '',
  fabric      text not null default '',
  fee         numeric not null default 0,               -- $M design fee for this season (first design free)
  dna_cost    numeric not null default 0,               -- $M tile surcharge from brand DNA
  designs_this_season int not null default 1,           -- how many designs the team fielded this season (drives unit cost)
  unit_cost   numeric not null default 0,               -- $ per garment before the foreignness tax, after the designs-this-season multiplier (mean over its lines)
  markets     jsonb not null default '[]'::jsonb,       -- markets this design was sold in
  is_copy     boolean not null default false,
  copied_from_team   text,
  copied_from_design text,
  primary key (game_id, season, team_id, design_id)
);

-- Sealed bids for the one local partner in each market. One row per team per market per season.
create table if not exists ww_bids (
  game_id    text not null references ww_games(id) on delete cascade,
  season     int  not null,
  market     text not null,
  team_id    text not null,
  amount     numeric not null default 0,                -- $M as written by the team
  capped_to  numeric,                                   -- $M after the partner bid cap, when it bit
  won        boolean not null default false,
  primary key (game_id, season, market, team_id)
);

-- Team-to-team carry: the partner holder in a market carries a rival's line for a fee and sees the design.
create table if not exists ww_deals (
  game_id      text not null references ww_games(id) on delete cascade,
  season       int  not null,
  deal_id      text not null,                           -- D-<season>-<market>-<n>
  market       text not null,
  holder_team  text not null,                           -- holds the partner seat in that market this season
  carried_team text not null,                           -- the rival whose line is carried
  design_id    text not null default '',
  fee          numeric not null default 0,              -- $M paid by the carried team to the holder
  status       text not null default 'offered',         -- offered | accepted | declined | void
  holder_saw_design boolean not null default false,
  copied       boolean not null default false,          -- the holder (or anyone) later copied the design
  copy_season  int,
  made_in_season int,                                   -- the season whose reveal the offer followed (season is the one it applies to)
  reason       text not null default '',                -- why a deal was declined or void
  primary key (game_id, season, deal_id)
);

-- Every decision and outcome, one row each, for the debrief. Same shape as the Parent Trap's pt_events plus market and why.
create table if not exists ww_log (
  game_id  text not null references ww_games(id) on delete cascade,
  seq      int  not null,
  round    int  not null default 0,                     -- season
  team_id  text,                                        -- null for world events
  market   text,
  type     text not null default '',                    -- event | design | plan | fog | bid | sale | copy | suit | street | carry | standing
  text     text not null default '',                    -- plain-words sentence for the projector and debrief
  why      text not null default '',
  payload  jsonb not null default '{}'::jsonb,          -- the numeric fields named in GAME_SPEC.md section 4
  primary key (game_id, seq)
);

create table if not exists ww_snapshots (
  game_id    text not null references ww_games(id) on delete cascade,
  round      int  not null,
  kind       text not null,                             -- public | view | reveal | result | final
  team_id    text not null default '',                  -- '' for public snapshots
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (game_id, round, kind, team_id)
);

alter table ww_games     enable row level security;
alter table ww_teams     enable row level security;
alter table ww_seats     enable row level security;
alter table ww_decisions enable row level security;
alter table ww_brands    enable row level security;
alter table ww_seasons   enable row level security;
alter table ww_designs   enable row level security;
alter table ww_bids      enable row level security;
alter table ww_deals     enable row level security;
alter table ww_log       enable row level security;
alter table ww_snapshots enable row level security;

do $$
declare t text;
begin
  foreach t in array array['ww_games','ww_teams','ww_seats','ww_decisions','ww_brands','ww_seasons','ww_designs','ww_bids','ww_deals','ww_log','ww_snapshots'] loop
    if not exists (select 1 from pg_policies where tablename = t and policyname = 'anon_all_' || t) then
      execute format('create policy %I on %I for all to anon using (true) with check (true)', 'anon_all_' || t, t);
    end if;
  end loop;
end $$;

-- Realtime: add each table to the publication once.
do $$
declare t text;
begin
  foreach t in array array['ww_games','ww_teams','ww_seats','ww_decisions','ww_brands','ww_seasons','ww_designs','ww_bids','ww_deals','ww_log','ww_snapshots'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;
