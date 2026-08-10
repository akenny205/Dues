-- Base tables. Converted from db/schema.sql, which existed only as a
-- reverse-engineered "context only, not meant to be run" snapshot and had
-- its tables in an order that violated its own foreign keys (Group
-- referenced User before User was created). This is the corrected,
-- actually-runnable version — verified against the live schema via
-- `pg_dump --schema-only`.
--
-- No RLS yet — that starts in the next migration, matching real history.

CREATE TABLE IF NOT EXISTS public."User" (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  username character varying NOT NULL UNIQUE,
  email character varying NOT NULL UNIQUE,
  CONSTRAINT "User_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public."Group" (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  name text DEFAULT ''::text,
  created_by bigint,
  CONSTRAINT "Group_pkey" PRIMARY KEY (id),
  CONSTRAINT "Group_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public."User"(id)
);

CREATE TABLE IF NOT EXISTS public."GroupMember" (
  id bigint NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  user_id bigint NOT NULL,
  role text,
  CONSTRAINT "GroupMember_pkey" PRIMARY KEY (id, user_id),
  CONSTRAINT "GroupMember_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public."User"(id),
  CONSTRAINT "GroupMember_id_fkey" FOREIGN KEY (id) REFERENCES public."Group"(id)
);

CREATE TABLE IF NOT EXISTS public."Session" (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  "Description" text,
  group_id bigint,
  CONSTRAINT "Session_pkey" PRIMARY KEY (id),
  CONSTRAINT "Session_group_id_fkey" FOREIGN KEY (group_id) REFERENCES public."Group"(id)
);

CREATE TABLE IF NOT EXISTS public."SessionPayment" (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  user_id bigint NOT NULL,
  session_id bigint,
  amount numeric,
  CONSTRAINT "SessionPayment_pkey" PRIMARY KEY (id),
  CONSTRAINT "SessionPayment_session_id_fkey" FOREIGN KEY (session_id) REFERENCES public."Session"(id),
  CONSTRAINT "SessionPayment_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public."User"(id)
);
