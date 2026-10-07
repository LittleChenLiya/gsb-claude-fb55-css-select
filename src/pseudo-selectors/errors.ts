/**
 * Error thrown when a custom (user-provided) pseudo-class fails to compile.
 *
 * The error carries the name of the pseudo-class and, once the failing
 * selector group has been located, the position of the group and rule within
 * the selector. The original error is preserved as `cause`.
 */
export class PseudoClassCompileError extends Error {
    /**
     * Index of the failing selector group within the token, or -1 if the
     * position hasn't been located yet.
     */
    groupIndex = -1;
    /**
     * Index of the failing rule within the failing selector group, or -1 if
     * the position hasn't been located yet.
     */
    ruleIndex = -1;

    constructor(
        /** Name of the custom pseudo-class that failed to compile. */
        readonly pseudoName: string,
        cause: unknown,
    ) {
        super("", { cause });
        this.name = "PseudoClassCompileError";
        this.updateMessage();
    }

    /** Whether the failing selector group has been located. */
    get isLocated(): boolean {
        return this.groupIndex >= 0;
    }

    /**
     * Record the position of the failing pseudo-class within the selector.
     *
     * Only the first (innermost) location is kept, so that nested
     * sub-selectors (e.g. `:is(…)`) report the position within the selector
     * group that actually contains the failing pseudo-class.
     * @param groupIndex Index of the failing selector group.
     * @param ruleIndex Index of the failing rule within the group.
     */
    locate(groupIndex: number, ruleIndex: number): void {
        if (this.isLocated) {
            return;
        }

        this.groupIndex = groupIndex;
        this.ruleIndex = ruleIndex;
        this.updateMessage();
    }

    private updateMessage(): void {
        const { cause } = this;
        const causeMessage =
            cause instanceof Error ? cause.message : String(cause);
        const position = this.isLocated
            ? ` at group ${this.groupIndex + 1}, rule ${this.ruleIndex + 1}`
            : "";

        this.message = `Failed to compile custom pseudo-class :${this.pseudoName}${position}: ${causeMessage}`;
    }
}
