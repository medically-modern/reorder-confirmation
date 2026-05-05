// ============================================================
// GET & POST /api/reorder-confirmation?token=xxx
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { lookupToken, markTokenSubmitted, isTokenSubmitted, logSubmission } from "@/lib/redis";
import { getItemById, updateItemColumns, uploadFileToColumn } from "@/lib/monday";
import { transformItemToConfirmationData, generateChangeSummary } from "@/lib/transform";
import {
  MONDAY_COLUMNS,
  ReorderSubmission,
  PatientOrderResponse,
} from "@/lib/types";

// =========================
// GET — Load patient data
// =========================
export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get("token");
    if (!token) {
      return NextResponse.json(
        { error: "Missing token" },
        { status: 400 }
      );
    }

    // Look up token in Redis
    const record = await lookupToken(token);
    if (!record) {
      return NextResponse.json(
        { error: "Invalid or expired link" },
        { status: 404 }
      );
    }

    // Check if already submitted
    const submitted = await isTokenSubmitted(token);
    if (submitted) {
      return NextResponse.json(
        {
          error: "already_submitted",
          message: "You have already submitted your response. If you need to make changes, please text or call us.",
        },
        { status: 409 }
      );
    }

    // Fetch item from Monday
    const item = await getItemById(record.mondayItemId);

    // Transform to patient-safe data
    const data = transformItemToConfirmationData(item);

    // Log the page load
    await logSubmission(token, {
      event: "page_loaded",
      itemId: record.mondayItemId,
    });

    return NextResponse.json(data);
  } catch (error) {
    console.error("GET /api/reorder-confirmation error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again or contact us." },
      { status: 500 }
    );
  }
}

// =========================
// POST — Submit response
// =========================
export async function POST(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get("token");
    if (!token) {
      return NextResponse.json(
        { error: "Missing token" },
        { status: 400 }
      );
    }

    // Look up token
    const record = await lookupToken(token);
    if (!record) {
      return NextResponse.json(
        { error: "Invalid or expired link" },
        { status: 404 }
      );
    }

    // Check duplicate submission
    if (await isTokenSubmitted(token)) {
      return NextResponse.json(
        { error: "You have already submitted your response." },
        { status: 409 }
      );
    }

    // Parse the submission — handle multipart for file uploads
    const contentType = request.headers.get("content-type") || "";
    let submission: ReorderSubmission;
    let insuranceFront: File | null = null;
    let insuranceBack: File | null = null;

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      submission = JSON.parse(
        formData.get("data") as string
      ) as ReorderSubmission;
      insuranceFront = formData.get("insuranceFront") as File | null;
      insuranceBack = formData.get("insuranceBack") as File | null;
    } else {
      submission = (await request.json()) as ReorderSubmission;
    }

    // Validate
    const errors = validateSubmission(submission);
    if (errors.length > 0) {
      return NextResponse.json({ error: "Validation failed", errors }, { status: 400 });
    }

    // Fetch current item for change summary
    const item = await getItemById(record.mondayItemId);
    const originalData = transformItemToConfirmationData(item);

    // Build Monday column updates
    const columnUpdates = buildColumnUpdates(submission, originalData);

    // Generate change summary
    const changeSummary = generateChangeSummary(originalData, {
      orderDetails: submission.orderDetails
        ? {
            sensorsType: submission.orderDetails.sensorsType || null,
            suppliesType: null,
            infusionSet1: submission.orderDetails.infusionSet1 || null,
            infusionQty1: submission.orderDetails.infusionQty1 ?? null,
            infusionSet2: submission.orderDetails.infusionSet2 || null,
            infusionQty2: submission.orderDetails.infusionQty2 ?? null,
          }
        : undefined,
      address: submission.address
        ? {
            street: submission.address.street,
            city: submission.address.city,
            state: submission.address.state,
            zip: submission.address.zip,
            fullAddress: `${submission.address.street}, ${submission.address.city}, ${submission.address.state} ${submission.address.zip}`,
          }
        : undefined,
      insuranceChanged: submission.insuranceResponse === "Changed",
      newInsuranceType: submission.newInsuranceType,
      orderResponse: submission.orderResponse,
      originalOrderDate: originalData.nextOrderDate,
    });

    // Add change summary to updates
    if (changeSummary) {
      columnUpdates[MONDAY_COLUMNS.patientChangeSummary] = {
        text: changeSummary,
      };
    }

    // Write to Monday
    await updateItemColumns(record.mondayItemId, columnUpdates);

    // Upload insurance files if provided
    if (insuranceFront) {
      await uploadFileToColumn(
        record.mondayItemId,
        MONDAY_COLUMNS.insuranceCardFile,
        insuranceFront
      );
      // Also upload to clinicals files if the column exists
      // await uploadFileToColumn(record.mondayItemId, MONDAY_COLUMNS.clinicalsFiles, insuranceFront);
    }
    if (insuranceBack) {
      await uploadFileToColumn(
        record.mondayItemId,
        MONDAY_COLUMNS.insuranceCardFile,
        insuranceBack
      );
    }

    // Mark token as submitted in Redis
    await markTokenSubmitted(token, submission.orderResponse);

    // Log submission
    await logSubmission(token, {
      event: "submitted",
      orderResponse: submission.orderResponse,
      changeSummary,
    });

    // Return appropriate confirmation message
    const message = getConfirmationMessage(submission);

    return NextResponse.json({
      success: true,
      message,
    });
  } catch (error) {
    console.error("POST /api/reorder-confirmation error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again or contact us." },
      { status: 500 }
    );
  }
}

// --- Validation ---
function validateSubmission(sub: ReorderSubmission): string[] {
  const errors: string[] = [];

  if (!["Confirm", "Delay", "Cancel"].includes(sub.orderResponse)) {
    errors.push("Invalid order response");
  }

  if (sub.orderResponse === "Delay" && !sub.delayIndefinitely && !sub.delayDate) {
    errors.push("Delay requires a date or indefinitely selection");
  }

  if (sub.address?.zip && !/^\d{5}$/.test(sub.address.zip)) {
    errors.push("ZIP code must be exactly 5 digits");
  }

  if (sub.insuranceResponse === "Changed") {
    if (!sub.newInsuranceType) {
      errors.push("New insurance type is required");
    }
    if (!sub.newMemberId) {
      errors.push("New member ID is required");
    }
  }

  return errors;
}

// --- Build Monday column update payload ---
function buildColumnUpdates(
  sub: ReorderSubmission,
  originalData: { nextOrderDate: string }
): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  const now = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

  // Always write: order response + timestamp
  updates[MONDAY_COLUMNS.patientOrderResponse] = {
    label: sub.orderResponse,
  };
  updates[MONDAY_COLUMNS.patientResponseTimestamp] = { date: now };

  // Insurance response
  updates[MONDAY_COLUMNS.patientInsuranceResponse] = {
    label: sub.insuranceResponse,
  };

  // --- Confirm flow ---
  if (sub.orderResponse === "Confirm") {
    if (sub.orderDetails) applyOrderUpdates(updates, sub);
    if (sub.address) applyAddressUpdate(updates, sub);
    if (sub.insuranceResponse === "Changed") applyInsuranceUpdate(updates, sub);
  }

  // --- Delay flow ---
  if (sub.orderResponse === "Delay") {
    if (sub.delayIndefinitely) {
      // Clear order date
      updates[MONDAY_COLUMNS.nextOrder] = {};
    } else if (sub.delayDate) {
      // Overwrite order date
      updates[MONDAY_COLUMNS.nextOrder] = { date: sub.delayDate };

      // If less than 20 days, treat like confirm (full flow required)
      const daysFromNow = daysBetween(new Date(), new Date(sub.delayDate));
      if (daysFromNow < 20) {
        if (sub.orderDetails) applyOrderUpdates(updates, sub);
        if (sub.address) applyAddressUpdate(updates, sub);
        if (sub.insuranceResponse === "Changed")
          applyInsuranceUpdate(updates, sub);
      } else {
        // 20+ days — optional updates
        if (sub.orderDetails) applyOrderUpdates(updates, sub);
        if (sub.address) applyAddressUpdate(updates, sub);
        if (sub.insuranceResponse === "Changed")
          applyInsuranceUpdate(updates, sub);
      }
    }
  }

  // --- Cancel flow ---
  if (sub.orderResponse === "Cancel") {
    // Clear order date
    updates[MONDAY_COLUMNS.nextOrder] = {};
  }

  return updates;
}

// --- Apply order detail updates ---
function applyOrderUpdates(
  updates: Record<string, unknown>,
  sub: ReorderSubmission
) {
  if (!sub.orderDetails) return;

  if (sub.orderDetails.sensorsType) {
    updates[MONDAY_COLUMNS.sensorsType] = {
      label: sub.orderDetails.sensorsType,
    };
  }
  if (sub.orderDetails.infusionSet1) {
    updates[MONDAY_COLUMNS.infusionSet1] = {
      label: sub.orderDetails.infusionSet1,
    };
  }
  if (sub.orderDetails.infusionQty1 !== undefined) {
    updates[MONDAY_COLUMNS.infQty1] = sub.orderDetails.infusionQty1.toString();
  }
  if (sub.orderDetails.infusionSet2) {
    updates[MONDAY_COLUMNS.infusionSet2] = {
      label: sub.orderDetails.infusionSet2,
    };
  }
  if (sub.orderDetails.infusionQty2 !== undefined) {
    updates[MONDAY_COLUMNS.infQty2] = sub.orderDetails.infusionQty2.toString();
  }
}

// --- Apply address update ---
function applyAddressUpdate(
  updates: Record<string, unknown>,
  sub: ReorderSubmission
) {
  if (!sub.address) return;
  const fullAddr = `${sub.address.street}, ${sub.address.city}, ${sub.address.state} ${sub.address.zip}`;
  updates[MONDAY_COLUMNS.address] = {
    address: fullAddr,
    lat: 0,
    lng: 0,
  };
}

// --- Apply insurance update ---
function applyInsuranceUpdate(
  updates: Record<string, unknown>,
  sub: ReorderSubmission
) {
  if (sub.newInsuranceType) {
    updates[MONDAY_COLUMNS.newInsuranceType] = sub.newInsuranceType;
  }
  if (sub.newMemberId) {
    updates[MONDAY_COLUMNS.newMemberId] = sub.newMemberId;
  }
}

// --- Confirmation messages ---
function getConfirmationMessage(sub: ReorderSubmission): string {
  if (sub.orderResponse === "Cancel") {
    return "We're sad to see you go! We'll cancel all ongoing reorders. Please text/call us if this was a mistake.";
  }

  if (sub.orderResponse === "Delay") {
    if (sub.delayIndefinitely) {
      return "Thank you! Your order has been paused. When you're ready to resume, please text or call us to set a new order date.";
    }
    const daysFromNow = sub.delayDate
      ? daysBetween(new Date(), new Date(sub.delayDate))
      : 0;
    if (daysFromNow < 20) {
      return "Thank you! Your order has been confirmed. We'll begin processing it shortly. Please reach out if anything changes.";
    }
    return "Thank you! Your order has been successfully delayed. We'll reach out again before your new order date.";
  }

  // Confirm
  return "Thank you! Your order has been confirmed. We'll begin processing it shortly. Please reach out if anything changes.";
}

// --- Utility ---
function daysBetween(a: Date, b: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.ceil((b.getTime() - a.getTime()) / msPerDay);
}
