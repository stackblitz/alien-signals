package alien.signals

class Effect<T>(private val fn: () -> T) : Subscriber {

    private var deps: MutableList<Signal<*>> = mutableListOf()
    private var flags: Int = 0

    override val deps: MutableList<Signal<*>>
        get() = deps

    override fun notify() {
        if (flags and DIRTY != 0) {
            run()
        } else if (flags and TO_CHECK_DIRTY != 0) {
            if (checkDirty(deps)) {
                run()
            } else {
                flags = flags and TO_CHECK_DIRTY.inv()
            }
        }
    }

    fun run(): T {
        val prevSub = activeSub
        val prevTrackId = activeTrackId
        setActiveSub(this, nextTrackId())
        startTrack(this)
        try {
            return fn()
        } finally {
            setActiveSub(prevSub, prevTrackId)
            endTrack(this)
        }
    }

    companion object {
        const val DIRTY = 1 shl 4
        const val TO_CHECK_DIRTY = 1 shl 3
    }
}
