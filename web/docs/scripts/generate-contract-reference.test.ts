import { describe, expect, it } from "vitest";
import {
  extractPrecedingDocComment,
  parseErrorEnum,
  parseExportedTypes,
  parseClientMethods,
  parseSdkErrorMap,
  mdxEscape,
  buildContractSection,
  buildSdkErrorsSection,
} from "./generate-contract-reference.mjs";

// Deliberately malformed/minimal fixture source, not this repo's own
// real packages/sdk files - same reasoning packages/sdk's own tests
// give for testing against fixtures rather than real generated
// bindings (those can and do change shape across a redeploy; this
// suite is about the PARSER's own correctness, not a snapshot of
// today's contracts). A real end-to-end run against the actual repo
// files happens every time this script runs for real (predev/
// prebuild/pretest, plus CI's own drift check) - this suite exists to
// catch a regression in the parsing/rendering logic itself, like the
// one caught during development: a lazy-regex doc-comment extractor
// that swallowed an unrelated EARLIER comment into a LATER
// undocumented method's "doc text".
const SAMPLE_TYPES_TS = `import {Address} from '@stellar/stellar-sdk';

export const Error = {
  1 : { message: "AlreadyInitialized" },
  /**
   * Doc comment for code 2.
   */
  2 : { message: "NotInitialized" }
}

/**
 * A documented struct.
 */
export interface Widget {
  id: string;
}

/**
 * A documented union.
 */
 export type Status =
  { tag: "On"; values: void } |
  { tag: "Off"; values: void };

export type ContractEvent = Widget;
`;

const SAMPLE_CLIENT_TS = `import {Widget} from './types.js';
import {Result, AssembledTransaction, Client as ContractClient, MethodOptions} from '@stellar/stellar-sdk/contract';

export interface Client {
  undocumented(args: { id: string }, options?: MethodOptions): Promise<AssembledTransaction<Widget>>;
  /**
   * A documented method.
   * Spanning two lines.
   */
  documented(options?: MethodOptions): Promise<AssembledTransaction<number>>;
}
`;

const SAMPLE_ERRORS_TS = `
const SAMPLE_ERRORS: ErrorCopyMap = {
  1: { name: "InlineOne", message: "Inline message one." },
  2: {
    name: "WrappedTwo",
    message: "Wrapped message two.",
  },
};
`;

describe("extractPrecedingDocComment", () => {
  it("returns the comment immediately preceding the given index", () => {
    const source = "/**\n * Hello.\n */\ntarget";
    const idx = source.indexOf("target");
    expect(extractPrecedingDocComment(source, idx)).toBe("Hello.");
  });

  it("returns an empty string when there is no preceding comment", () => {
    const source = "no comment here\ntarget";
    const idx = source.indexOf("target");
    expect(extractPrecedingDocComment(source, idx)).toBe("");
  });

  it("does not swallow an EARLIER, unrelated comment when the immediately preceding text has none - the real bug this script hit in development", () => {
    const source = [
      "/**",
      " * Comment for the FIRST method.",
      " */",
      "first(): void;",
      "second(): void;", // no comment of its own
    ].join("\n");
    const idx = source.indexOf("second(): void;");
    expect(extractPrecedingDocComment(source, idx)).toBe("");
  });

  it("attaches the correct NEAREST comment when two documented declarations are adjacent", () => {
    const source = [
      "/**",
      " * Comment A.",
      " */",
      "a(): void;",
      "/**",
      " * Comment B.",
      " */",
      "b(): void;",
    ].join("\n");
    const idx = source.indexOf("b(): void;");
    expect(extractPrecedingDocComment(source, idx)).toBe("Comment B.");
  });
});

describe("parseErrorEnum", () => {
  it("parses every numeric code, name, and doc comment from the Error block", () => {
    const entries = parseErrorEnum(SAMPLE_TYPES_TS);
    expect(entries).toEqual([
      { code: 1, name: "AlreadyInitialized", doc: "" },
      { code: 2, name: "NotInitialized", doc: "Doc comment for code 2." },
    ]);
  });

  it("throws a descriptive error when the Error block is missing entirely", () => {
    expect(() => parseErrorEnum("export const NotError = {};")).toThrow(/could not find/);
  });
});

describe("parseExportedTypes", () => {
  it("parses every exported interface/type with its doc comment, excluding ContractEvent", () => {
    const types = parseExportedTypes(SAMPLE_TYPES_TS);
    expect(types).toEqual([
      { name: "Widget", kind: "interface", doc: "A documented struct." },
      { name: "Status", kind: "type", doc: "A documented union." },
    ]);
  });
});

describe("parseClientMethods", () => {
  it("parses every Client interface method, with and without a doc comment", () => {
    const methods = parseClientMethods(SAMPLE_CLIENT_TS);
    expect(methods).toEqual([
      {
        name: "undocumented",
        doc: "",
        signature: "undocumented(args: { id: string }, options?: MethodOptions): Promise<AssembledTransaction<Widget>>",
      },
      {
        name: "documented",
        doc: "A documented method.\nSpanning two lines.",
        signature: "documented(options?: MethodOptions): Promise<AssembledTransaction<number>>",
      },
    ]);
  });

  it("throws a descriptive error when no Client interface is found", () => {
    expect(() => parseClientMethods("export const notAClient = {};")).toThrow(/could not find/);
  });
});

describe("parseSdkErrorMap", () => {
  it("parses both inline and multi-line (wrapped) entries from the same map - the exact shape packages/sdk/src/errors.ts actually mixes", () => {
    const entries = parseSdkErrorMap(SAMPLE_ERRORS_TS, "SAMPLE_ERRORS");
    expect(entries).toEqual([
      { code: 1, name: "InlineOne", message: "Inline message one." },
      { code: 2, name: "WrappedTwo", message: "Wrapped message two." },
    ]);
  });

  it("throws a descriptive error when the named map is not found", () => {
    expect(() => parseSdkErrorMap(SAMPLE_ERRORS_TS, "MISSING_MAP")).toThrow(/could not find/);
  });
});

describe("mdxEscape", () => {
  it("escapes curly braces so MDX never parses them as an expression", () => {
    expect(mdxEscape("a {b} c")).toBe("a &#123;b&#125; c");
  });

  it("normalizes em and en dashes - this repo's own em/en-dash ban applies to generated output too, and some real doc comments in packages/sdk predate that convention", () => {
    // Built via String.fromCharCode, not a literal character in this
    // file's own source text, for the same reason
    // generate-contract-reference.mjs's own mdxEscape avoids one.
    const emDash = String.fromCharCode(8212);
    const enDash = String.fromCharCode(8211);
    expect(mdxEscape(`a ${emDash} b`)).toBe("a - b");
    expect(mdxEscape(`a ${enDash} b`)).toBe("a-b");
  });
});

describe("buildContractSection", () => {
  it("renders a complete section from fixture types.ts/client.ts with a given contract id", () => {
    const section = buildContractSection({
      title: "Widget",
      contractId: "CSAMPLE000000000000000000000000000000000000000000000000000",
      typesSource: SAMPLE_TYPES_TS,
      clientSource: SAMPLE_CLIENT_TS,
    });

    expect(section).toContain("## Widget");
    expect(section).toContain("CSAMPLE000000000000000000000000000000000000000000000000000");
    expect(section).toContain("### `undocumented`");
    expect(section).toContain("### `documented`");
    expect(section).toContain("A documented method.");
    expect(section).toContain("### `Widget`");
    expect(section).toContain("### `Status`");
    expect(section).toContain("| 1 | `AlreadyInitialized` | - |");
    expect(section).toContain("| 2 | `NotInitialized` | Doc comment for code 2. |");
  });
});

describe("buildSdkErrorsSection", () => {
  it("throws when one of the six expected error maps is missing from the source - the generator must fail loudly, not silently produce a partial reference page", () => {
    expect(() => buildSdkErrorsSection(SAMPLE_ERRORS_TS)).toThrow(/could not find "const FINALIZE_ERRORS/);
  });
});
