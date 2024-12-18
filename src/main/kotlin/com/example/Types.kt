package com.example

interface ISignal<T> {
    fun get(): T
}

interface IWritableSignal<T> : ISignal<T> {
    fun set(value: T)
}
