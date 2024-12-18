package com.example

class Computed<T>(private val getter: () -> T) {

    private var cachedValue: T? = null
    private var version: Int = 0

    private var subs: MutableList<Subscriber> = mutableListOf()
    private var lastTrackedId: Int = 0

    private var deps: MutableList<Signal<*>> = mutableListOf()
    private var flags: Int = 0

    fun get(): T {
        if (flags and DIRTY != 0) {
            update()
        } else if (flags and TO_CHECK_DIRTY != 0) {
            if (checkDirty(deps)) {
                update()
            } else {
                flags = flags and TO_CHECK_DIRTY.inv()
            }
        }
        if (activeTrackId != null) {
            if (lastTrackedId != activeTrackId) {
                lastTrackedId = activeTrackId
                link(this, activeSub!!)
            }
        } else if (activeScopeTrackId != null) {
            if (lastTrackedId != activeScopeTrackId) {
                lastTrackedId = activeScopeTrackId
                link(this, activeEffectScope!!)
            }
        }
        return cachedValue!!
    }

    fun update(): Boolean {
        val prevSub = activeSub
        val prevTrackId = activeTrackId
        setActiveSub(this, nextTrackId())
        startTrack(this)
        val oldValue = cachedValue
        val newValue: T
        try {
            newValue = getter()
        } finally {
            setActiveSub(prevSub, prevTrackId)
            endTrack(this)
        }
        if (oldValue != newValue) {
            cachedValue = newValue
            version++
            return true
        }
        return false
    }

    private fun checkDirty(deps: List<Signal<*>>): Boolean {
        for (dep in deps) {
            if (dep is Computed<*>) {
                if (dep.version != version) {
                    return true
                }
                if (dep.flags and DIRTY != 0) {
                    if (dep.update()) {
                        return true
                    }
                } else if (dep.flags and TO_CHECK_DIRTY != 0) {
                    if (checkDirty(dep.deps)) {
                        if (dep.update()) {
                            return true
                        }
                    } else {
                        dep.flags = dep.flags and TO_CHECK_DIRTY.inv()
                    }
                }
            }
        }
        return false
    }

    private fun link(dep: Signal<*>, sub: Subscriber) {
        sub.deps.add(dep)
        dep.subs.add(sub)
    }

    companion object {
        const val DIRTY = 1 shl 4
        const val TO_CHECK_DIRTY = 1 shl 3
    }
}

interface Subscriber {
    val deps: MutableList<Signal<*>>
    fun notify()
}

var activeTrackId: Int? = null
var activeSub: Subscriber? = null
var activeScopeTrackId: Int? = null
var activeEffectScope: Subscriber? = null

fun setActiveSub(sub: Subscriber?, trackId: Int?) {
    activeSub = sub
    activeTrackId = trackId
}

fun nextTrackId(): Int {
    return (activeTrackId ?: 0) + 1
}

fun startTrack(sub: Subscriber) {
    sub.deps.clear()
}

fun endTrack(sub: Subscriber) {
    // No-op for now
}
