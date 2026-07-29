-- Datos de referencia para instalaciones nuevas (regalos y paquetes).
--
-- PostgreSQL database dump
--

-- Dumped from database version 16.4 (Debian 16.4-1.pgdg110+2)
-- Dumped by pg_dump version 16.4 (Debian 16.4-1.pgdg110+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: diamond_packages; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.diamond_packages (id, name, diamonds, bonus_diamonds, price_cop, is_active, sort_order) FROM stdin;
c211bd0c-2404-415d-a789-5d3972392c94	5.000 + 1.000 bonus	5000	1000	74900	t	3
b45724e6-1086-4991-8125-a0e861c63ceb	500 diamantes	500	0	9900	t	1
ac7170e5-3508-4a5c-8365-dcff7308dd59	1.500 + 200 bonus	1500	200	24900	t	2
\.


--
-- Data for Name: gift_catalog; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.gift_catalog (id, name, emoji, cost_diamonds, animation, is_active, sort_order) FROM stdin;
df51f626-b407-4e55-a3e0-71409c3d7d18	Rosa	🌹	50	float	t	1
0843d7d1-1f9e-4df3-850b-12de316cffde	Chocolate	🍫	80	float	t	2
d2480214-057e-401e-8a5b-7872ecb6e021	Oso	🧸	150	float	t	3
2056dd54-f7b7-418c-a2e2-0595855c5feb	Anillo	💍	500	sparkle	t	4
8dcaeae4-ecad-4cad-bcf3-2fa123edb6c3	Auto	🚗	1000	drive	t	5
693f1db0-f9ab-405d-84f9-093f792bf268	Fuegos	🎆	2000	burst	t	6
1dbb5a29-0d31-479f-bde8-3d5f5f79e712	Castillo	🏰	3000	grand	t	7
aabbdc89-8502-4c05-b7c4-e5d7b44a4b93	Corona	👑	5000	crown	t	8
88f4430a-ed0b-4ef8-ac80-45a677eebb83	Rosa	🌹	50	float	t	1
1895d643-6e29-4dea-9650-26e332941720	Chocolate	🍫	80	float	t	2
d785afe3-aa4a-498e-95fb-d710f874b0ae	Oso	🧸	150	float	t	3
fe49c8a8-e66b-416a-bb8b-082c6f9ca972	Anillo	💍	500	sparkle	t	4
8eb0dbe4-4b71-490b-b371-134b1bf1ff18	Auto	🚗	1000	drive	t	5
daced313-ce61-4031-a7c9-da16e136b2ad	Fuegos	🎆	2000	burst	t	6
c2e7f2fd-9ecb-4cec-834f-95e64eed9dd6	Castillo	🏰	3000	grand	t	7
e54c4e03-b7ce-4230-a4e0-e253e610f1a9	Corona	👑	5000	crown	t	8
\.


--
-- PostgreSQL database dump complete
--

