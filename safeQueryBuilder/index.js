/* safeQueryBuilder - dynamic, secure SQL builder */
//buildDynamicQueryWithCountSafe
function listDataQuery({
  table,
  allowedTables = [],
  allowedColumns = ['*'],
  columns = ['*'],
  joins = [],
  filters = {},
  orderBy = '',
  orderDir = 'ASC',
  limit = 10,
  offset = 0,
  groupBy = [],
  having = {}
}) {
  const values = [];

  if (!allowedTables.includes(table)) {
    throw new Error(`Table "${table}" is not allowed.`);
  }

  // validate select columns
  const validColumns = columns.filter(col => {
    return col === '*' ||
           allowedColumns.some(
             allowed =>
               col === allowed ||
               (col.includes(' AS ') && allowedColumns.includes(col.split(' AS ')[0]))
           );
  });
  if (!validColumns.length) throw new Error('No valid columns selected.');

  /* ---------- build FROM + JOIN ---------- */
  let baseQuery = ` FROM ${table}`;
  for (const join of joins) {
    if (!allowedTables.includes(join.table)) {
      throw new Error(`Join table "${join.table}" is not allowed.`);
    }
    const joinType = (join.type || 'LEFT').toUpperCase();
    baseQuery += ` ${joinType} JOIN ${join.table} ON ${join.on}`;
  }

  /* ---------- WHERE ---------- */
  baseQuery += ' WHERE 1=1';

  for (const [key, cond] of Object.entries(filters)) {
    if (!allowedColumns.includes(key)) throw new Error(`Filter column "${key}" is not allowed.`);
    const value    = typeof cond === 'object' ? cond.value    : cond;
    const operator = typeof cond === 'object' ? (cond.operator || '=') : '=';

    if (value === undefined || value === '' || value === null) continue;

    switch (operator.toUpperCase()) {
      case '=':
        baseQuery += ` AND ${key} = ?`;
        values.push(value);
        break;
      case 'LIKE':
        baseQuery += ` AND ${key} LIKE ?`;
        values.push(`%${value}%`);
        break;
      case 'OR LIKE':
        baseQuery += ` OR ${key} LIKE ?`;
        values.push(`%${value}%`);
        break;
      case '>=': case '<=': case '>': case '<':
        baseQuery += ` AND ${key} ${operator} ?`;
        values.push(value);
        break;
      case 'IN':
        if (!Array.isArray(value) || !value.length) break;
        baseQuery += ` AND ${key} IN (${value.map(()=>'?').join(', ')})`;
        values.push(...value);
        break;
      case 'BETWEEN':
        if (!Array.isArray(value) || value.length !== 2)
          throw new Error(`BETWEEN requires [min,max] for ${key}`);
        baseQuery += ` AND ${key} BETWEEN ? AND ?`;
        values.push(value[0], value[1]);
        break;
      default:
        throw new Error(`Unsupported operator "${operator}" for column "${key}"`);
    }
  }

  /* ---------- GROUP BY ---------- */
  let groupClause = '';
  if (groupBy.length) {
    for (const col of groupBy) {
      if (!allowedColumns.includes(col))
        throw new Error(`GroupBy column "${col}" is not allowed.`);
    }
    groupClause = ` GROUP BY ${groupBy.join(', ')}`;
  }

  /* ---------- HAVING ---------- */
  let havingClause = '';
  if (Object.keys(having).length) {
    havingClause = ' HAVING 1=1';
    for (const [key, cond] of Object.entries(having)) {
      const value    = typeof cond === 'object' ? cond.value    : cond;
      const operator = typeof cond === 'object' ? (cond.operator || '=') : '=';

      switch (operator.toUpperCase()) {
        case '=': case '>': case '<': case '>=': case '<=':
          havingClause += ` AND ${key} ${operator} ?`;
          values.push(value);
          break;
        case 'BETWEEN':
          if (!Array.isArray(value) || value.length !== 2)
            throw new Error(`HAVING BETWEEN requires [min,max] for ${key}`);
          havingClause += ` AND ${key} BETWEEN ? AND ?`;
          values.push(value[0], value[1]);
          break;
        default:
          throw new Error(`Unsupported HAVING operator "${operator}"`);
      }
    }
  }

  /* ---------- ORDER BY ---------- */
  let orderClause = '';
  if (orderBy && allowedColumns.includes(orderBy)) {
    orderClause = ` ORDER BY ${orderBy} ${orderDir || 'ASC'}`;
  }

  /* ---------- Final Queries ---------- */
  const dataQuery  = `SELECT ${validColumns.join(', ')}${baseQuery}${groupClause}${havingClause}${orderClause} LIMIT ? OFFSET ?`;
  const dataValues = [...values, Number(limit), Number(offset)];

  let countQuery;
  if (groupClause || havingClause) {
    // wrap subquery for accurate count & performance
    countQuery = `SELECT COUNT(*) as total FROM (SELECT 1${baseQuery}${groupClause}${havingClause}) AS sub`;
  } else {
    countQuery = `SELECT COUNT(1) as total${baseQuery}`;
  }
  const countValues = [...values];

  return { dataQuery, dataValues, countQuery, countValues };
}

/*---DataTables Server Side---*/
async function listDatatableQuery({
  db,
  table,
  allowedTables,
  allowedColumns,
  joins = [],
  groupBy = null,
  customFilters = [],
  extraWhere = [],
  draw = 0,
  start = 0,
  length = 10,
  search,
  orders='',
  colOrder=''
}) {  

  // ⬇️ Build filter dari global search
  const searchFilters = [];
  if (search) {
    for (const col of allowedColumns) {
      searchFilters.push({ key: col, operator: 'LIKE', value: `%${search}%` });
    }
  }

  const filterClause = searchFilters.length
    ? [{ or: searchFilters }]
    : [];

  // ⬇️ Build order
  const order = orders!='' ? { column: colOrder, dir: orders } : [];

  // ⬇️ Hitung total sebelum filter
  const totalQuery = buildCountQuerySafe({
    table,
    allowedTables,
    allowedColumns,
    joins,
  });
  const [totalResult] = await db.query(totalQuery.query, totalQuery.values);
  const recordsTotal = totalResult[0]?.total || 0;

  // ⬇️ Hitung total setelah filter
  const filteredQuery = buildCountQuerySafe({
    table,
    allowedTables,
    allowedColumns,
    joins,
    filters: filterClause.concat(extraWhere || []),
    groupBy,
  });
  const [filteredResult] = await db.query(filteredQuery.query, filteredQuery.values);
  const recordsFiltered = filteredResult[0]?.total || 0;

  // ⬇️ Ambil data
  const dataQuery = selectQuery({
    table,
    allowedTables,
    allowedColumns,
    joins,
    filters: filterClause.concat(extraWhere || []),
    groupBy,
    orderBy: order,
    limit: length,
    offset: start,
  });
  const [rows] = await db.query(dataQuery.query, dataQuery.values);

  return {
    draw,
    recordsTotal,
    recordsFiltered,
    data: rows,
  };
}

/* ---------- UPDATE ---------- */
//buildUpdateQuerySafe
function updateQuery({
  table,
  allowedTables = [],
  allowedColumns = [],
  data = {},
  where = {}
}) {
  if (!allowedTables.includes(table)) throw new Error(`Table "${table}" is not allowed.`);

  const setParts = [];
  const values   = [];

  for (const [key, val] of Object.entries(data)) {
    if (!allowedColumns.includes(key))
      throw new Error(`Column "${key}" is not allowed for update.`);
    setParts.push(`${key} = ?`);
    values.push(val);
  }
  if (!setParts.length) throw new Error('No valid fields to update.');

  let whereClause = ' WHERE 1=1';
  for (const [key, val] of Object.entries(where)) {
    if (!allowedColumns.includes(key))
      throw new Error(`WHERE column "${key}" is not allowed.`);
    whereClause += ` AND ${key} = ?`;
    values.push(val);
  }

  return { query: `UPDATE ${table} SET ${setParts.join(', ')}${whereClause}`, values };
}

/* ---------- DELETE ---------- */
//buildDeleteQuerySafe
function deleteQuery({
  table,
  allowedTables = [],
  allowedColumns = [],
  where = {}
}) {
  if (!allowedTables.includes(table)) throw new Error(`Table "${table}" is not allowed.`);
  if (!Object.keys(where).length)
    throw new Error('DELETE must have a WHERE condition to prevent full-table deletion.');

  const values      = [];
  let whereClause = ' WHERE 1=1';
  for (const [key, val] of Object.entries(where)) {
    if (!allowedColumns.includes(key))
      throw new Error(`WHERE column "${key}" is not allowed.`);
    whereClause += ` AND ${key} = ?`;
    values.push(val);
  }
  return { query: `DELETE FROM ${table}${whereClause}`, values };
}

/* ---------- INSERT with ON DUPLICATE KEY UPDATE ---------- */
//buildInsertOneQuerySafe
function insertOneQuery({
  table,
  allowedTables = [],
  allowedColumns = [],
  data = {},
  onDuplicate = [] // array of column names to update
}) {
  if (!allowedTables.includes(table)) throw new Error(`Table "${table}" is not allowed.`);

  const keys = Object.keys(data).filter(key => allowedColumns.includes(key));
  if (!keys.length) throw new Error('No valid fields to insert.');

  const columns = keys.join(', ');
  const placeholders = keys.map(() => '?').join(', ');
  const values = keys.map(k => data[k]);

  let query = `INSERT INTO ${table} (${columns}) VALUES (${placeholders})`;

  if (onDuplicate.length) {
    const updates = onDuplicate
      .filter(key => allowedColumns.includes(key) && keys.includes(key))
      .map(key => `${key} = VALUES(${key})`);

    if (updates.length) {
      query += ' ON DUPLICATE KEY UPDATE ' + updates.join(', ');
    }
  }

  return { query, values };
}

/* ---------- INSERT MULTIPLE ROWS ---------- */
//buildInsertManyQuerySafe
function insertManyQuery({
  table,
  allowedTables = [],
  allowedColumns = [],
  rows = [] // array of objects
}) {
  if (!allowedTables.includes(table))
    throw new Error(`Table "${table}" is not allowed.`);
  if (!Array.isArray(rows) || rows.length === 0)
    throw new Error('Rows must be a non‑empty array.');

  // Use keys from first row as reference
  const keys = Object.keys(rows[0]).filter(k => allowedColumns.includes(k));
  if (!keys.length)
    throw new Error('No valid columns to insert.');

  // Validate all rows have same keys
  for (const r of rows) {
    const rowKeys = Object.keys(r).filter(k => allowedColumns.includes(k));
    if (rowKeys.length !== keys.length ||
        !rowKeys.every(k => keys.includes(k))) {
      throw new Error('All rows must have the same set of allowed columns.');
    }
  }

  const columns = keys.join(', ');
  const placeholdersPerRow = '(' + keys.map(() => '?').join(', ') + ')';
  const placeholders = rows.map(() => placeholdersPerRow).join(', ');
  const values = [];
  rows.forEach(r => keys.forEach(k => values.push(r[k])));

  const query = `INSERT INTO ${table} (${columns}) VALUES ${placeholders}`;
  return { query, values };
}

/*-----COUNT DATA--------*/
//buildCountQuerySafe
function countQuery({
  table,
  allowedTables,
  allowedColumns,
  joins = [],
  filters = [],
  groupBy = null,
  having = [],
}) {
  if (!allowedTables.includes(table)) throw new Error("Table not allowed");

  const whereClause = buildWhereClause(filters, allowedColumns);
  const joinClause = buildJoinClause(joins, allowedTables);
  const groupClause = groupBy ? `GROUP BY ${sanitizeColumn(groupBy, allowedColumns)}` : '';
  const havingClause = buildHavingClause(having, allowedColumns);

  const fullFrom = `FROM ${table} ${joinClause} ${whereClause} ${groupClause} ${havingClause}`.trim();

  let query = '';
  if (groupBy) {
    // Bungkus dengan subquery jika ada GROUP BY
    query = `SELECT COUNT(*) as total FROM (SELECT 1 ${fullFrom}) AS temp`;
  } else {
    // Hitung langsung
    query = `SELECT COUNT(1) as total ${fullFrom}`;
  }

  const values = [...extractFilterValues(filters), ...extractFilterValues(having)];
  return { query, values };
}


/*---General Query---*/
function sanitizeColumn(column, allowedColumns) {
  if (!allowedColumns.includes(column)) throw new Error("Column not allowed");
  return column;
}

function extractFilterValues(filters) {
  const values = [];
  for (const f of filters) {
    if (f.operator === 'BETWEEN' && Array.isArray(f.value)) {
      values.push(f.value[0], f.value[1]);
    } else if (f.operator === 'IN' && Array.isArray(f.value)) {
      values.push(...f.value);
    } else {
      values.push(f.value);
    }
  }
  return values;
}

function buildWhereClause(filters, allowedColumns) {
  if (!filters.length) return '';
  const clauses = filters.map(f => {
    if (!allowedColumns.includes(f.key)) throw new Error("Column not allowed in WHERE");
    if (f.operator === 'BETWEEN') return `${f.key} BETWEEN ? AND ?`;
    if (f.operator === 'IN') return `${f.key} IN (${f.value.map(() => '?').join(',')})`;
    if (f.operator === 'LIKE') return `${f.key} LIKE ?`;
    if (f.operator === 'OR LIKE') return `${f.key} LIKE ?`; // treated same here
    return `${f.key} ${f.operator} ?`;
  });
  return 'WHERE ' + clauses.join(' AND ');
}

function buildJoinClause(joins, allowedTables) {
  return joins.map(join => {
    if (!allowedTables.includes(join.table)) throw new Error("Join table not allowed");
    return `${join.type || 'INNER'} JOIN ${join.table} ON ${join.on}`;
  }).join(' ');
}

function buildHavingClause(having, allowedColumns) {
  if (!having.length) return '';
  const clauses = having.map(h => {
    if (!allowedColumns.includes(h.key)) throw new Error("Column not allowed in HAVING");
    if (h.operator === 'BETWEEN') return `${h.key} BETWEEN ? AND ?`;
    if (h.operator === 'IN') return `${h.key} IN (${h.value.map(() => '?').join(',')})`;
    return `${h.key} ${h.operator} ?`;
  });
  return 'HAVING ' + clauses.join(' AND ');
}

function buildCountQuerySafe({
  table,
  allowedTables,
  allowedColumns,
  joins = [],
  filters = [],
  groupBy = null,
  having = [],
}) {
  if (!allowedTables.includes(table)) throw new Error("Table not allowed");

  const whereClause = buildWhereClause(filters, allowedColumns);
  const joinClause = buildJoinClause(joins, allowedTables);
  const groupClause = groupBy ? `GROUP BY ${sanitizeColumn(groupBy, allowedColumns)}` : '';
  const havingClause = buildHavingClause(having, allowedColumns);

  const fullFrom = `FROM ${table} ${joinClause} ${whereClause} ${groupClause} ${havingClause}`.trim();

  let query = '';
  if (groupBy) {
    query = `SELECT COUNT(*) as total FROM (SELECT 1 ${fullFrom}) AS temp`;
  } else {
    query = `SELECT COUNT(1) as total ${fullFrom}`;
  }

  const values = [...extractFilterValues(filters), ...extractFilterValues(having)];
  return { query, values };
}


function selectQuery({
  table,
  allowedTables,
  allowedColumns,
  columns = ['*'],
  filters = [],
  joins = [],
  groupBy = null,
  having = [],
  orderBy = [],
  limit = 0,
  offset = 0
}) {
  if (!allowedTables.includes(table)) throw new Error("Table not allowed");

  const colList = columns.includes('*')
    ? '*'
    : columns.map(c => sanitizeColumn(c, allowedColumns)).join(', ');

  const whereClause = buildWhereClause(filters, allowedColumns);
  const joinClause = buildJoinClause(joins, allowedTables);
  const groupClause = groupBy ? `GROUP BY ${sanitizeColumn(groupBy, allowedColumns)}` : '';
  const havingClause = buildHavingClause(having, allowedColumns);
  const orderClause = orderBy.length
    ? 'ORDER BY ' + orderBy.map(o => `${sanitizeColumn(o.column, allowedColumns)} ${o.dir}`).join(', ')
    : '';
  const limitClause = limit ? `LIMIT ${offset || 0}, ${limit}` : '';

  const query = `SELECT ${colList} FROM ${table} ${joinClause} ${whereClause} ${groupClause} ${havingClause} ${orderClause} ${limitClause}`.trim();
  const values = [...extractFilterValues(filters), ...extractFilterValues(having)];

  return { query, values };
}





module.exports = {
  listDataQuery,
  listDatatableQuery,
  updateQuery,
  deleteQuery,
  insertOneQuery,
  insertManyQuery,
  countQuery,
  selectQuery
};