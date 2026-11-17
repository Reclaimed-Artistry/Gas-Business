-- Restore DML ... RETURNING support for the isolated BlueFlame schema.
-- PostgreSQL regex \b is not a word boundary; explicitly match whitespace instead.
CREATE OR REPLACE FUNCTION blueflame.exec_sql(p_sql text, p_params jsonb DEFAULT '[]'::jsonb, p_mode text DEFAULT 'query'::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'blueflame', 'public' AS $function$
DECLARE v_sql TEXT; v_rows JSONB; v_changes INT;
BEGIN
  v_sql := btrim(blueflame._bind_params(p_sql, p_params), E' \t\n\r;');
  IF p_mode = 'exec' THEN
    EXECUTE v_sql;
    GET DIAGNOSTICS v_changes = ROW_COUNT;
    RETURN jsonb_build_object('changes', v_changes, 'rows', '[]'::jsonb);
  ELSIF v_sql ~* '^(INSERT|UPDATE|DELETE)([[:space:]]|$)' THEN
    EXECUTE 'WITH _bf_res AS (' || v_sql || ') SELECT COALESCE(jsonb_agg(row_to_json(_bf_res)), ''[]''::jsonb) FROM _bf_res' INTO v_rows;
    RETURN jsonb_build_object('rows', COALESCE(v_rows, '[]'::jsonb), 'changes', jsonb_array_length(COALESCE(v_rows, '[]'::jsonb)));
  ELSE
    EXECUTE 'SELECT COALESCE(jsonb_agg(row_to_json(_bf_res)), ''[]''::jsonb) FROM (' || v_sql || ') _bf_res' INTO v_rows;
    RETURN jsonb_build_object('rows', COALESCE(v_rows, '[]'::jsonb), 'changes', jsonb_array_length(COALESCE(v_rows, '[]'::jsonb)));
  END IF;
END;
$function$;
