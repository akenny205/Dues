-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.Group (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  name text DEFAULT ''::text,
  created_by bigint,
  CONSTRAINT Group_pkey PRIMARY KEY (id),
  CONSTRAINT Group_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.User(id)
);
CREATE TABLE public.GroupMember (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  user_id bigint NOT NULL,
  role text,
  CONSTRAINT GroupMember_pkey PRIMARY KEY (id, user_id),
  CONSTRAINT GroupMember_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.User(id),
  CONSTRAINT GroupMember_id_fkey FOREIGN KEY (id) REFERENCES public.Group(id)
);
CREATE TABLE public.Session (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  Description text,
  group_id bigint,
  CONSTRAINT Session_pkey PRIMARY KEY (id),
  CONSTRAINT Session_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.Group(id)
);
CREATE TABLE public.SessionPayment (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  user_id bigint NOT NULL,
  session_id bigint,
  amount numeric,
  CONSTRAINT SessionPayment_pkey PRIMARY KEY (id),
  CONSTRAINT SessionPayment_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.Session(id),
  CONSTRAINT SessionPayment_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.User(id)
);
CREATE TABLE public.User (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  username character varying NOT NULL UNIQUE,
  email character varying NOT NULL UNIQUE,
  CONSTRAINT User_pkey PRIMARY KEY (id)
);