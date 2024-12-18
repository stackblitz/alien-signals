package com.example.Unstable

import com.example.Computed
import com.example.Signal

class ComputedSet<I, O>(
    private val set: Signal<Set<I>>,
    private val getGetter: (item: Signal<I>) -> () -> O
) {
    private val size = Computed { set.get().size }
    private val keys = Computed {
        val keys = mutableListOf<String>()
        for (item in set.get()) {
            keys.add(item.toString())
        }
        keys
    }
    private val items = Computed {
        val array = mutableListOf<Computed<O>>()
        for (item in set.get()) {
            val signalItem = Signal(item)
            array.add(Computed(getGetter(signalItem)))
        }
        array
    }

    operator fun get(item: I): O? {
        return items.get().find { it.get() == item }?.get()
    }

    val size: Int
        get() = size.get()

    val allKeys: List<String>
        get() = keys.get()
}
