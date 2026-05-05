// ============================================================
// Transform Monday data → patient-safe API responses
// ============================================================

import {
  MondayItem,
  getColumnText,
  getColumnNumber,
  getColumnValue,
} from "./monday";
import {
  MONDAY_COLUMNS,
  INSURANCE_SIMPLIFICATION_MAP,
  INSURANCE_OPTIONS,
  HIGH_QUANTITY_INSURERS,
  ReorderConfirmationData,
  OrderDetails,
  PatientAddress,
  PatientInsurance,
  SubscriptionType,
  InsuranceOption,
} from "./types";

// --- Main transform: Monday item → patient-facing data ---
export function transformItemToConfirmationData(
  item: MondayItem
): ReorderConfirmationData {
  const rawInsurance = getColumnText(item, MONDAY_COLUMNS.primaryInsurance);
  const memberId = getColumnText(item, MONDAY_COLUMNS.memberId1) || "";

  return {
    fullName: item.name,
    subscriptionType: parseSubscriptionType(
      getColumnText(item, MONDAY_COLUMNS.subscription)
    ),
    nextOrderDate: parseOrderDate(item),
    orderDetails: buildOrderDetails(item),
    address: buildAddress(item),
    insurance: buildInsurance(rawInsurance, memberId),
    dropdownOptions: {
      sensorTypes: getSensorTypeOptions(),
      infusionSets: getInfusionSetOptions(),
      suppliesTypes: getSuppliesTypeOptions(),
      insuranceTypes: INSURANCE_OPTIONS,
    },
    maxInfusionQty: getMaxInfusionQty(rawInsurance),
  };
}

// --- Subscription type ---
function parseSubscriptionType(raw: string | null): SubscriptionType {
  if (raw === "Sensors & Supplies") return "Sensors & Supplies";
  if (raw === "Sensors") return "Sensors";
  return "Supplies";
}

// --- Order date ---
function parseOrderDate(item: MondayItem): string {
  const cv = getColumnValue(item, MONDAY_COLUMNS.nextOrder);
  return cv?.date || cv?.text || "";
}

// --- Order details (only include actively served items) ---
function buildOrderDetails(item: MondayItem): OrderDetails {
  const sensorsType = getColumnText(item, MONDAY_COLUMNS.sensorsType);
  const suppliesType = getColumnText(item, MONDAY_COLUMNS.suppliesType);
  const infSet1 = getColumnText(item, MONDAY_COLUMNS.infusionSet1);
  const infSet2 = getColumnText(item, MONDAY_COLUMNS.infusionSet2);

  return {
    sensorsType: isServing(sensorsType) ? sensorsType : null,
    suppliesType: isServing(suppliesType) ? suppliesType : null,
    infusionSet1: isServing(infSet1) ? infSet1 : null,
    infusionQty1: isServing(infSet1)
      ? getColumnNumber(item, MONDAY_COLUMNS.infQty1)
      : null,
    infusionSet2: isServing(infSet2) ? infSet2 : null,
    infusionQty2: isServing(infSet2)
      ? getColumnNumber(item, MONDAY_COLUMNS.infQty2)
      : null,
  };
}

// --- Check if a field value indicates "actively serving" ---
function isServing(value: string | null): boolean {
  if (!value) return false;
  const lower = value.toLowerCase();
  return lower !== "not serving" && lower !== "stopped serving" && lower !== "";
}

// --- Address ---
function buildAddress(item: MondayItem): PatientAddress {
  const cv = getColumnValue(item, MONDAY_COLUMNS.address);

  // Monday location type stores structured data
  if (cv?.address || cv?.street) {
    const street = [cv.street_number, cv.street].filter(Boolean).join(" ");
    const city = cv.city || "";
    // We don't get state/zip cleanly from Monday's location type
    // The full address string usually has it
    const fullAddr = cv.address || cv.text || "";
    const { state, zip } = parseStateZipFromAddress(fullAddr);

    return {
      street: street || fullAddr.split(",")[0]?.trim() || "",
      city,
      state,
      zip,
      fullAddress: fullAddr,
    };
  }

  // Fallback: parse from text
  const text = cv?.text || "";
  return parseAddressFromText(text);
}

// --- Parse state and zip from a full address string ---
function parseStateZipFromAddress(addr: string): {
  state: string;
  zip: string;
} {
  // Try to match patterns like "NY 10001" or "New York, NY 10001"
  const match = addr.match(/\b([A-Z]{2})\s+(\d{5})(?:-\d{4})?\b/);
  if (match) {
    return { state: match[1], zip: match[2] };
  }
  return { state: "", zip: "" };
}

// --- Parse address from freeform text ---
function parseAddressFromText(text: string): PatientAddress {
  const parts = text.split(",").map((p) => p.trim());
  const { state, zip } = parseStateZipFromAddress(text);

  return {
    street: parts[0] || "",
    city: parts[1] || "",
    state,
    zip,
    fullAddress: text,
  };
}

// --- Insurance ---
function buildInsurance(
  rawType: string | null,
  memberId: string
): PatientInsurance {
  const simplified =
    INSURANCE_SIMPLIFICATION_MAP[rawType || ""] || ("Other" as InsuranceOption);
  const masked = maskMemberId(memberId);

  return {
    simplifiedType: simplified,
    rawType: rawType || "Unknown",
    maskedMemberId: masked,
  };
}

// --- Mask member ID: show only last 4 digits ---
function maskMemberId(id: string): string {
  if (!id || id.length <= 4) return id;
  const last4 = id.slice(-4);
  const masked = "*".repeat(id.length - 4);
  return `${masked}${last4}`;
}

// --- Max infusion set quantity based on insurance ---
function getMaxInfusionQty(rawInsurance: string | null): number {
  if (!rawInsurance) return 3;
  return HIGH_QUANTITY_INSURERS.includes(rawInsurance) ? 9 : 3;
}

// --- Dropdown options (hardcoded from Monday board settings) ---
function getSensorTypeOptions(): string[] {
  return [
    "FreeStyle Libre 2 Plus",
    "FreeStyle Libre 3 Plus",
    "FreeStyle Libre 14-Day",
    "Guardian 4",
    "Dexcom G6",
    "Dexcom G7",
    "Dexcom G7 15-Day",
    "Instinct",
  ];
}

function getInfusionSetOptions(): string[] {
  return [
    'AutoSoft XC 6mm 23"',
    'AutoSoft XC 6mm 32"',
    'AutoSoft XC 6mm 43"',
    'AutoSoft XC 6mm 5"',
    'AutoSoft XC 9mm 23"',
    'AutoSoft XC 9mm 43"',
    'AutoSoft 90 6mm 23"',
    'AutoSoft 90 6mm 43"',
    'AutoSoft 90 9mm 23"',
    'AutoSoft 90 9mm 43"',
    'AutoSoft 30 13mm 23"',
    'AutoSoft 30 13mm 43"',
    'TruSteel 6mm 23"',
    'TruSteel 6mm 32"',
    'TruSteel 8mm 23"',
    'TruSteel 8mm 32"',
    'VariSoft 13mm 23"',
    'VariSoft 13mm 32"',
    'VariSoft 17mm 23"',
    'Contact 6mm 23"',
    'Inset 6mm 23"',
    'Luer 6mm 32"',
    'Mio Advance Clear 9mm 23"',
  ];
}

function getSuppliesTypeOptions(): string[] {
  return ["Mobi", "t:slim", "iLet", "Minimed 780G"];
}

// --- Generate change summary ---
export function generateChangeSummary(
  original: ReorderConfirmationData,
  submitted: {
    orderDetails?: OrderDetails;
    address?: PatientAddress;
    insuranceChanged?: boolean;
    newInsuranceType?: string;
    orderResponse?: string;
    delayDate?: string;
    originalOrderDate?: string;
  }
): string {
  const changes: string[] = [];

  // Order detail changes
  if (submitted.orderDetails) {
    const orig = original.orderDetails;
    const sub = submitted.orderDetails;

    if (sub.sensorsType && sub.sensorsType !== orig.sensorsType) {
      changes.push(
        `Sensor type changed from ${orig.sensorsType} to ${sub.sensorsType}.`
      );
    }
    if (sub.infusionSet1 && sub.infusionSet1 !== orig.infusionSet1) {
      changes.push(
        `Infusion set 1 changed from ${orig.infusionSet1} to ${sub.infusionSet1}.`
      );
    }
    if (
      sub.infusionQty1 !== undefined &&
      sub.infusionQty1 !== orig.infusionQty1
    ) {
      changes.push(
        `Infusion set 1 quantity changed from ${orig.infusionQty1} to ${sub.infusionQty1}.`
      );
    }
    if (sub.infusionSet2 && sub.infusionSet2 !== orig.infusionSet2) {
      changes.push(
        `Infusion set 2 changed from ${orig.infusionSet2} to ${sub.infusionSet2}.`
      );
    }
    if (
      sub.infusionQty2 !== undefined &&
      sub.infusionQty2 !== orig.infusionQty2
    ) {
      changes.push(
        `Infusion set 2 quantity changed from ${orig.infusionQty2} to ${sub.infusionQty2}.`
      );
    }
  }

  // Address changes
  if (submitted.address) {
    const newAddr = `${submitted.address.street}, ${submitted.address.city}, ${submitted.address.state} ${submitted.address.zip}`;
    if (newAddr !== original.address.fullAddress) {
      changes.push(
        `Address changed from ${original.address.fullAddress} to ${newAddr}.`
      );
    }
  }

  // Insurance changes
  if (submitted.insuranceChanged && submitted.newInsuranceType) {
    changes.push(
      `Insurance changed from ${original.insurance.simplifiedType} ending in ${original.insurance.maskedMemberId.slice(-4)} to ${submitted.newInsuranceType}, new member ID provided.`
    );
  }

  // Cancel — note deleted order date
  if (submitted.orderResponse === "Cancel" && submitted.originalOrderDate) {
    changes.push(`Deleted order date of ${submitted.originalOrderDate}.`);
  }

  return changes.join(" ");
}
