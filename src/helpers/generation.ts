/**
 * An explicit generation tracker used to invalidate cached query results.
 *
 * The caller is responsible for advancing the generation whenever the
 * underlying DOM changes. When the generation advances, all cached
 * results tied to this generation are invalidated and will be recomputed
 * on the next query.
 *
 * This does not add any automatic change listeners or in-flight snapshots;
 * the caller explicitly controls when the generation advances.
 */
export class Generation {
    private _version = 0;

    /** The current generation version. */
    get version(): number {
        return this._version;
    }

    /**
     * Advance the generation, invalidating all cached results tied to
     * this generation.
     */
    advance(): void {
        this._version++;
    }
}
