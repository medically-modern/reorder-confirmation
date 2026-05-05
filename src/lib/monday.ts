// ============================================================
// Monday.com GraphQL API Client
// ============================================================

const MONDAY_API_URL = "https://api.monday.com/v2";
const MONDAY_FILE_URL = "https://api.monday.com/v2/file";

function getApiToken(): string {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) throw new Error("MONDAY_API_TOKEN not set");
  return token;
}

function getBoardId(): string {
  return process.env.MONDAY_BOARD_ID || "18407459988";
}

// --- Generic GraphQL query ---
export async function mondayQuery<T = unknown>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const res = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: getApiToken(),
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Monday API error ${res.status}: ${text}`);
  }

  const json = await res.json();

  if (json.errors?.length) {
    throw new Error(`Monday GraphQL error: ${JSON.stringify(json.errors)}`);
  }

  return json.data as T;
}

// --- Fetch a single item by ID with all column values ---
export async function getItemById(itemId: string) {
  const query = `
    query ($itemId: [ID!]!) {
      items(ids: $itemId) {
        id
        name
        column_values {
          id
          type
          text
          value
          ... on StatusValue {
            label
          }
          ... on DateValue {
            date
          }
          ... on PhoneValue {
            phone
            country_short_name
          }
          ... on EmailValue {
            email
            text
          }
          ... on LocationValue {
            lat
            lng
            address
            city
            street
            street_number
            country_short_name
            place_id
          }
          ... on NumbersValue {
            number
          }
          ... on LongTextValue {
            text
          }
        }
      }
    }
  `;

  const data = await mondayQuery<{ items: MondayItem[] }>(query, {
    itemId: [itemId],
  });

  if (!data.items?.length) {
    throw new Error(`Item ${itemId} not found`);
  }

  return data.items[0];
}

// --- Update column values on an item ---
export async function updateItemColumns(
  itemId: string,
  columnValues: Record<string, unknown>
) {
  const boardId = getBoardId();
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnValues: JSON!) {
      change_multiple_column_values(
        board_id: $boardId
        item_id: $itemId
        column_values: $columnValues
      ) {
        id
      }
    }
  `;

  return mondayQuery(query, {
    boardId,
    itemId,
    columnValues: JSON.stringify(columnValues),
  });
}

// --- Upload a file to a column ---
export async function uploadFileToColumn(
  itemId: string,
  columnId: string,
  file: File
): Promise<void> {
  const query = `mutation ($file: File!) { add_file_to_column (item_id: ${itemId}, column_id: "${columnId}", file: $file) { id } }`;

  const formData = new FormData();
  formData.append("query", query);
  formData.append("variables[file]", file);

  const res = await fetch(MONDAY_FILE_URL, {
    method: "POST",
    headers: {
      Authorization: getApiToken(),
    },
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Monday file upload error ${res.status}: ${text}`);
  }
}

// --- Find item by column value (for token lookup fallback) ---
export async function findItemByColumnValue(
  columnId: string,
  value: string
) {
  const boardId = getBoardId();
  const query = `
    query ($boardId: ID!, $columnId: String!, $value: CompareValue!) {
      boards(ids: [$boardId]) {
        items_page(
          limit: 1
          query_params: {
            rules: [{ column_id: $columnId, compare_value: $value }]
          }
        ) {
          items {
            id
            name
          }
        }
      }
    }
  `;

  const data = await mondayQuery<{
    boards: [{ items_page: { items: { id: string; name: string }[] } }];
  }>(query, { boardId, columnId, value });

  return data.boards[0]?.items_page?.items?.[0] || null;
}

// --- Get column settings (dropdown options, status labels) ---
export async function getBoardColumns() {
  const boardId = getBoardId();
  const query = `
    query ($boardId: [ID!]!) {
      boards(ids: $boardId) {
        columns {
          id
          title
          type
          settings_str
        }
      }
    }
  `;

  const data = await mondayQuery<{
    boards: [{ columns: MondayColumn[] }];
  }>(query, { boardId: [boardId] });

  return data.boards[0].columns;
}

// --- Types ---
export interface MondayItem {
  id: string;
  name: string;
  column_values: MondayColumnValue[];
}

export interface MondayColumnValue {
  id: string;
  type: string;
  text: string | null;
  value: string | null;
  label?: string | null;
  date?: string | null;
  phone?: string | null;
  email?: string | null;
  number?: number | null;
  // Location fields
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
  city?: string | null;
  street?: string | null;
  street_number?: string | null;
  country_short_name?: string | null;
  place_id?: string | null;
}

export interface MondayColumn {
  id: string;
  title: string;
  type: string;
  settings_str: string;
}

// --- Helper: extract a column value from an item ---
export function getColumnValue(
  item: MondayItem,
  columnId: string
): MondayColumnValue | undefined {
  return item.column_values.find((cv) => cv.id === columnId);
}

// --- Helper: get text/label from a column ---
export function getColumnText(
  item: MondayItem,
  columnId: string
): string | null {
  const cv = getColumnValue(item, columnId);
  if (!cv) return null;
  // Status columns use label, others use text
  return cv.label || cv.text || null;
}

// --- Helper: get number from a column ---
export function getColumnNumber(
  item: MondayItem,
  columnId: string
): number | null {
  const cv = getColumnValue(item, columnId);
  if (!cv) return null;
  if (cv.number !== undefined && cv.number !== null) return cv.number;
  // Fallback: parse from text
  const num = parseFloat(cv.text || "");
  return isNaN(num) ? null : num;
}
