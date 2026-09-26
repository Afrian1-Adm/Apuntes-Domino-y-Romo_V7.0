do $block$
begin
    if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'partidas_resumen'
    ) then
        alter publication supabase_realtime add table public.partidas_resumen;
    end if;
end;
$block$;
