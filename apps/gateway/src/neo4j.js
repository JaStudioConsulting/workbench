const FORBIDDEN = /\b(CALL|CREATE|MERGE|SET|DELETE|REMOVE|DROP|ALTER|GRANT|DENY|REVOKE|LOAD|FOREACH|START|STOP|TERMINATE|SHOW|USE|INDEX|CONSTRAINT)\b/i;

export function stripCypherLiteralsAndComments(query) {
  return String(query)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n\r]*/g, " ")
    .replace(/(['"])(?:\\.|(?!\1)[^\\])*\1/g, "''");
}

export function assertReadOnlyCypher(query) {
  if (String(query).includes(";")) throw Object.assign(new Error("Neo4j adapter is read-only"), { code: "NEO4J_WRITE_REJECTED" });
  const clean = stripCypherLiteralsAndComments(query);
  if (FORBIDDEN.test(clean) || !/^\s*(OPTIONAL\s+MATCH|MATCH|WITH|UNWIND)\b/i.test(clean) || !/\bRETURN\b/i.test(clean)) {
    throw Object.assign(new Error("Neo4j adapter is read-only"), { code: "NEO4J_WRITE_REJECTED" });
  }
}

export function createReadOnlyNeo4jAdapter(driver) {
  return Object.freeze({
    enabled: Boolean(driver),
    async read(cypher, parameters = {}) {
      if (!driver) return { available: false, records: [] };
      assertReadOnlyCypher(cypher);
      const session = driver.session({ defaultAccessMode: "READ" });
      try { return { available: true, records: await session.run(cypher, parameters) }; }
      finally { await session.close(); }
    },
    async write() { throw Object.assign(new Error("Neo4j adapter is read-only"), { code: "NEO4J_WRITE_REJECTED" }); },
  });
}
