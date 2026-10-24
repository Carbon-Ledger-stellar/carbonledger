import type { Meta, StoryObj } from "@storybook/react";
import SerialRangeBar from "../SerialRangeBar";
import { buildBatchSerialSegments } from "../../lib/serial-range-segments";

const meta: Meta<typeof SerialRangeBar> = {
  title: "Components/SerialRangeBar",
  component: SerialRangeBar,
  parameters: { layout: "padded" },
};

export default meta;
type Story = StoryObj<typeof meta>;

const BATCH_START = "CL-2024-0001";
const BATCH_END = "CL-2024-0100";

export const EmptyBatch: Story = {
  args: { batchSerialStart: BATCH_START, batchSerialEnd: BATCH_START, segments: [] },
};

export const PartialRetirement: Story = {
  args: {
    batchSerialStart: BATCH_START,
    batchSerialEnd: BATCH_END,
    segments: buildBatchSerialSegments(BATCH_START, BATCH_END, [
      {
        serialStart: "CL-2024-0001",
        serialEnd: "CL-2024-0040",
        amount: 40,
        retirementId: "ret-partial-001",
        retirementDate: "2024-03-15T00:00:00Z",
        beneficiary: "Green Holdings Ltd",
      },
    ]),
  },
};

export const FullRetirement: Story = {
  args: {
    batchSerialStart: BATCH_START,
    batchSerialEnd: BATCH_END,
    segments: buildBatchSerialSegments(BATCH_START, BATCH_END, [
      {
        serialStart: BATCH_START,
        serialEnd: BATCH_END,
        amount: 100,
        retirementId: "ret-full-001",
        retirementDate: "2024-06-01T00:00:00Z",
        beneficiary: "Net Zero Industries",
      },
    ]),
  },
};

export const FragmentedRetirements: Story = {
  args: {
    batchSerialStart: BATCH_START,
    batchSerialEnd: BATCH_END,
    segments: buildBatchSerialSegments(BATCH_START, BATCH_END, [
      { serialStart: "CL-2024-0010", serialEnd: "CL-2024-0020", amount: 11, retirementId: "ret-a" },
      { serialStart: "CL-2024-0050", serialEnd: "CL-2024-0060", amount: 11, retirementId: "ret-b" },
      { serialStart: "CL-2024-0090", serialEnd: "CL-2024-0095", amount: 6, retirementId: "ret-c" },
    ]),
  },
};

export const CurrentlyListed: Story = {
  args: {
    batchSerialStart: BATCH_START,
    batchSerialEnd: BATCH_END,
    segments: buildBatchSerialSegments(
      BATCH_START,
      BATCH_END,
      [{ serialStart: "CL-2024-0001", serialEnd: "CL-2024-0025", amount: 25, retirementId: "ret-listed-mix" }],
      [{ serialStart: "CL-2024-0060", serialEnd: "CL-2024-0080", amount: 21 }],
    ),
  },
};

/**
 * AllFourStatuses — exercises every status at once:
 *   • CL-2024-0001 – 0020  → retired (20 credits, Green Holdings Ltd)
 *   • CL-2024-0021 – 0040  → active  (20 credits, implicit gap)
 *   • CL-2024-0041 – 0060  → listed  (20 credits)
 *   • CL-2024-0061 – 0080  → escrow  (20 credits)
 *   • CL-2024-0081 – 0100  → active  (20 credits, implicit gap)
 */
export const AllFourStatuses: Story = {
  name: "All Four Statuses (Escrow)",
  args: {
    batchSerialStart: BATCH_START,
    batchSerialEnd: BATCH_END,
    segments: buildBatchSerialSegments(
      BATCH_START,
      BATCH_END,
      // retirements
      [
        {
          serialStart: "CL-2024-0001",
          serialEnd: "CL-2024-0020",
          amount: 20,
          retirementId: "ret-escrow-story-001",
          retirementDate: "2024-09-01T00:00:00Z",
          beneficiary: "Green Holdings Ltd",
        },
      ],
      // listings
      [{ serialStart: "CL-2024-0041", serialEnd: "CL-2024-0060", amount: 20 }],
      // escrow
      [{ serialStart: "CL-2024-0061", serialEnd: "CL-2024-0080", amount: 20 }],
    ),
  },
};
