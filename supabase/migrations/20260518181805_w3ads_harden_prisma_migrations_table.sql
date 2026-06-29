ALTER TABLE IF EXISTS w3ads._prisma_migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE w3ads._prisma_migrations FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
