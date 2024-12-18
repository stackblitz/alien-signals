package alien.signals

class EffectScope : Subscriber {

    private var deps: MutableList<Signal<*>> = mutableListOf()
    private var flags: Int = 0

    override val deps: MutableList<Signal<*>>
        get() = deps

    fun run(fn: () -> Unit) {
        val prevSub = activeSub
        val prevTrackId = activeTrackId
        setActiveSub(this, nextTrackId())
        startTrack(this)
        try {
            fn()
        } finally {
            setActiveSub(prevSub, prevTrackId)
            endTrack(this)
        }
    }

    fun stop() {
        startTrack(this)
        endTrack(this)
    }
}
