package com.example.Unstable

import com.example.Computed

class EqualityComputed<T>(getter: () -> T) : Computed<T>(getter) {

    override fun update(): Boolean {
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
        if (!equals(oldValue, newValue)) {
            cachedValue = newValue
            version++
            return true
        }
        return false
    }

    private fun equals(a: Any?, b: Any?): Boolean {
        if (a === b) return true
        if (a == null || b == null) return false
        if (a::class != b::class) return false
        if (a is Array<*> && b is Array<*>) {
            if (a.size != b.size) return false
            for (i in a.indices) {
                if (!equals(a[i], b[i])) return false
            }
            return true
        }
        if (a is Collection<*> && b is Collection<*>) {
            if (a.size != b.size) return false
            val iterA = a.iterator()
            val iterB = b.iterator()
            while (iterA.hasNext() && iterB.hasNext()) {
                if (!equals(iterA.next(), iterB.next())) return false
            }
            return true
        }
        if (a is Map<*, *> && b is Map<*, *>) {
            if (a.size != b.size) return false
            for (key in a.keys) {
                if (!b.containsKey(key) || !equals(a[key], b[key])) return false
            }
            return true
        }
        return a == b
    }
}
