package com.example

class Signal<T>(private var currentValue: T) {

    private var lastTrackedId: Int = 0
    private var subs: MutableList<Subscriber> = mutableListOf()

    fun get(): T {
        if (activeTrackId != null && lastTrackedId != activeTrackId) {
            lastTrackedId = activeTrackId
            link(this, activeSub!!)
        }
        return currentValue
    }

    fun set(value: T) {
        if (currentValue != value) {
            currentValue = value
            propagate(subs)
        }
    }

    private fun propagate(subs: List<Subscriber>) {
        for (sub in subs) {
            sub.notify()
        }
    }

    private fun link(dep: Signal<T>, sub: Subscriber) {
        sub.deps.add(dep)
        dep.subs.add(sub)
    }
}

interface Subscriber {
    val deps: MutableList<Signal<*>>
    fun notify()
}

var activeTrackId: Int? = null
var activeSub: Subscriber? = null
