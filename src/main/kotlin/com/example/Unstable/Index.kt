package com.example.Unstable

import com.example.Computed
import com.example.Signal

class Index<I, O>(
    private val arr: Signal<List<I>>,
    private val getGetter: (item: Signal<I>, index: Int) -> () -> O
) {
    private val length = Computed { arr.get().size }
    private val keys = Computed {
        val keys = mutableListOf<String>()
        for (i in 0 until length.get()) {
            keys.add(i.toString())
        }
        keys
    }
    private val items = Computed {
        val array = mutableListOf<Computed<O>>()
        while (array.size < length.get()) {
            val index = array.size
            val item = Computed { arr.get()[index] }
            array.add(Computed(getGetter(item, index)))
        }
        if (array.size > length.get()) {
            array.subList(length.get(), array.size).clear()
        }
        array
    }

    operator fun get(index: Int): O? {
        return items.get().getOrNull(index)?.get()
    }

    val size: Int
        get() = length.get()

    val allKeys: List<String>
        get() = keys.get()
}
